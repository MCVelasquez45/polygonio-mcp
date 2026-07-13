# Automation Phase 2A — Safety Foundation

Status: **implemented, awaiting review**. Branch: `feat/automation-phase-2a-safety`.

Phase 2A establishes persistence, broker boundaries, idempotency, reconciliation,
health gates, and deterministic test infrastructure. **No market signal can
submit a broker order in this phase** — there is no scheduler, no bar
evaluation, and no signal→submission path anywhere in the module.

---

## Architecture

```
                                   ┌────────────────────────────────────────┐
                                   │        /api/automation (routes)        │
                                   │ health · reconcile · sessions · events │
                                   └───────────────┬────────────────────────┘
                                                   │
                                    automation.service (facade)
                                                   │
        ┌──────────────┬───────────────┬───────────┼──────────────┬───────────────┐
        ▼              ▼               ▼           ▼              ▼               ▼
  sessionRecovery  reconciliation  orderIntent  marketClock  automationHealth  automationAudit
  (init gates,     (12-step        (idempotent  (broker=     (gate rollup →   (JSON console +
   readiness)       startup scan)   journal)     authority)   automationReady)  automation_events)
        │              │               │           │
        └──────────────┴───────┬───────┴───────────┘
                               ▼
                     PaperBrokerAdapter (interface — the ONLY broker boundary)
                       ├── alpacaPaperBrokerAdapter (paper-only, hard live guard)
                       │     └── features/broker/services/alpaca.ts (SDK lives here only)
                       └── mockPaperBrokerAdapter (deterministic, tests)
                               ▼
                     MongoDB: automation_sessions · automation_order_intents ·
                              automation_broker_orders · automation_events
```

Boot (`server/src/index.ts`): the HTTP server starts first; `initializeAutomation()`
then runs asynchronously — enabled gate → **Mongo gate (fail closed)** →
paper-only adapter construction → **startup reconciliation** → readiness.

## State tables

**AutomationSession.status**: `CREATED → READY ⇄ PAUSED → STOPPED`, plus
`EMERGENCY_STOPPED` and `UNAVAILABLE`. Only `READY` is runnable, and only while
MongoDB is connected. `PAUSED` carries `pauseReason`.

**OrderIntent.status**:

| From | To | Trigger |
|---|---|---|
| — | `CREATED` | `createOrderIntent` (idempotent upsert) |
| `CREATED` | `SUBMITTING` | persist-then-act, before any broker call |
| `SUBMITTING` | `SUBMITTED` | broker ack, or recovery found the order by client_order_id |
| `SUBMITTING` | `SUBMITTING` | ambiguous submit failure (timeout) — parked for reconciliation, never blind-retried |
| `SUBMITTING` | `MANUAL_REVIEW` | reconciliation: no matching broker order |
| `SUBMITTING`/`CREATED` | `BROKER_REJECTED` | broker reject response |
| any non-terminal | `FAILED` / `COMPLETED` | reserved for Phase 2B lifecycle |

**BrokerOrder.status** (broker responses only, never internal events):
`CREATED, SUBMITTING, ACCEPTED, PENDING_NEW, PARTIALLY_FILLED, FILLED,
CANCEL_PENDING, CANCELLED, REJECTED, EXPIRED, REPLACED, UNKNOWN, MANUAL_REVIEW`.
The sole writer is `recordBrokerOrderSnapshot(order, {source})`, which rejects
payloads lacking `brokerOrderId`/`rawStatus` and any non-broker `source`
(allowed: `submit-response`, `order-poll`, `reconciliation`, `manual-review`).

## MongoDB models & indexes

| Collection | Model | Key indexes |
|---|---|---|
| `automation_sessions` | AutomationSession | `{status:1, updatedAt:-1}`, `{underlying:1, status:1}` |
| `automation_order_intents` | AutomationOrderIntent | **`{idempotencyKey:1} unique`**, `{clientOrderId:1}`, `{automationSessionId:1, createdAt:-1}` |
| `automation_broker_orders` | AutomationBrokerOrder | `{brokerOrderId:1} unique`, `{clientOrderId:1}`, `{automationSessionId:1, updatedAt:-1}` |
| `automation_events` | AutomationEvent (append-only) | `{automationSessionId:1, timestamp:-1}`, `{event:1, timestamp:-1}`, `{severity:1, timestamp:-1}` |

Idempotency key = `sha256(automationSessionId | strategyVersionId | underlying |
signalDirection | closedBarTimestamp(ISO) | intentType)`;
`client_order_id = "at2a-" + key[0:32]` (deterministic, ≤48 chars).
Creating the same intent twice returns the existing record
(`DUPLICATE_INTENT_SUPPRESSED` event) and never touches the broker.

## Broker interface

`services/brokerAdapter.ts` — automation code may only talk to this:

```ts
interface PaperBrokerAdapter {
  describe(): { name: string; mode: 'alpaca-paper' | 'mock'; paper: true };
  getAccount(): Promise<BrokerAccount>;          // account id is masked
  getClock(): Promise<BrokerClock>;
  listOpenOrders(): Promise<BrokerOrder[]>;
  getOrder(orderId: string): Promise<BrokerOrder>;
  getOrderByClientOrderId(id: string): Promise<BrokerOrder | null>; // reconcile primitive
  submitOrder(intent: ApprovedOrderIntent): Promise<BrokerOrder>;
  cancelOrder(orderId: string): Promise<BrokerOrder>;
  listPositions(): Promise<BrokerPosition[]>;
  getPosition(symbol: string): Promise<BrokerPosition | null>;
  closePosition(symbol: string, reason: string): Promise<BrokerOrder>;
}
```

- The Alpaca SDK is only reachable via `features/broker/services/alpaca.ts`
  (extended additively: `getAlpacaOrder`, `getAlpacaOrderByClientOrderId`,
  `cancelAlpacaOrder`, `closeAlpacaPosition`, `getAlpacaEnvironment`).
- **Hard live guard**: `assertPaperConfiguration()` throws
  `LiveTradingBlockedError` when `ALPACA_PAPER=false` or the base URL targets
  `api.alpaca.markets`. It runs at adapter construction AND before every
  `submitOrder`/`closePosition`.

## Reconciliation algorithm (startup + `POST /api/automation/reconcile`)

1. Load sessions in `READY`/`PAUSED`.
2. Load intents in `CREATED`/`SUBMITTING`/`SUBMITTED`.
3. Load broker open orders.  4. Load broker positions.
5. Match each non-`CREATED` intent by `brokerOrderId`, then `clientOrderId`;
   matched → journal the broker snapshot, advance intent to broker truth.
6. `SUBMITTING`/`SUBMITTED` intent with no broker order → intent
   `MANUAL_REVIEW`, session `PAUSED` (`LOCAL_ORDER_MISSING_AT_BROKER`, critical).
7. Broker order with our `at2a-` prefix but no local intent → **imported**
   (journaled, unowned) + flagged (`BROKER_ORDER_MISSING_LOCALLY`). Orders
   without the prefix belong to manual/UI trading and are ignored.
8. Broker position on a session's underlying with no local intent → session
   `PAUSED` (`ORPHANED_BROKER_POSITION`, critical). Positions unrelated to any
   automation underlying are ignored (manual trading is expected).
9. Clean sessions marked `reconciliationStatus=CLEAN` + `lastReconciledAt`.
10–12. Report persisted in module state + `RECONCILIATION_COMPLETE` event;
   ambiguity is only ever paused/parked — reconciliation **never submits,
   resubmits, cancels, closes, or recreates** anything.

## Failure behavior

| Failure | Behavior |
|---|---|
| Mongo down at init | status `UNAVAILABLE`, structured `AUTOMATION_UNAVAILABLE_MONGO_DOWN` (critical), no scheduler, no intents, no submissions |
| Mongo down later | every intent/journal/service call throws `MongoUnavailableError` (fail closed) |
| Live broker config | `LiveTradingBlockedError` at construction and at submit |
| Broker down / timeout | adapter calls time out (`AUTOMATION_BROKER_TIMEOUT_MS`, default 8s) → `BrokerUnavailableError`; health gate fails |
| Submit timeout | intent stays `SUBMITTING` (ambiguous), one resolve-by-client-id attempt, otherwise parked for reconciliation — never blind-retried |
| Market clock unknown/conflicting | `canEnter=false`; `MarketClockBlockedError` on ENTRY; exits are deliberately not clock-gated |
| Reconciliation failure | report `FAILED`, readiness false |

## Health gates — `GET /api/automation/health`

Separately reported: `mongodb`, `brokerApi`, `brokerMode`, `marketClock`,
`massiveMarketData` (supporting — degraded does not block), `reconciliation`.
`automationReady` is true only when: Mongo passes ∧ broker reachable ∧ broker
mode is paper ∧ clock is not UNKNOWN ∧ startup reconciliation completed without
FAILED ∧ runtime state is READY. HTTP status: 200 when ready, 503 otherwise.

## API

| Method & path | Purpose |
|---|---|
| `GET  /api/automation/health` | gate rollup + `automationReady` |
| `POST /api/automation/reconcile` | run the reconciliation procedure now |
| `POST /api/automation/sessions` | create a paper session (`{strategyVersionId, underlying}`) |
| `GET  /api/automation/sessions` | list sessions |
| `GET  /api/automation/sessions/:id` | session detail |
| `GET  /api/automation/sessions/:id/events` | append-only event journal |
| `GET  /api/automation/sessions/:id/orders` | `{intents, brokerOrders}` |

```bash
curl -s localhost:4000/api/automation/health | jq
curl -s -X POST localhost:4000/api/automation/reconcile | jq
curl -s -X POST localhost:4000/api/automation/sessions \
  -H 'content-type: application/json' \
  -d '{"strategyVersionId":"sv-demo-1","underlying":"SPY"}' | jq
curl -s localhost:4000/api/automation/sessions | jq
curl -s localhost:4000/api/automation/sessions/<id>/events | jq
curl -s localhost:4000/api/automation/sessions/<id>/orders | jq
```

## Environment

| Var | Default | Meaning |
|---|---|---|
| `AUTOMATION_ENABLED` | `true` | `false` disables init entirely (state `DISABLED`) |
| `AUTOMATION_BROKER` | `alpaca-paper` | `mock` selects the deterministic mock |
| `AUTOMATION_BROKER_TIMEOUT_MS` | `8000` | per-broker-call timeout |
| `AUTOMATION_CLOCK_TTL_MS` | `15000` | market-clock decision cache |

## Tests

```bash
cd server
npm run test:automation     # builds, then node --test tests/automation.*.test.mjs
```

23 tests across three files, using `mongodb-memory-server` (dev-dependency;
downloads a local mongod binary on first run) and the deterministic mock
broker. **No test touches the real Alpaca API or the network** (Massive is
pointed at an unroutable local port). Coverage maps 1:1 to the 15 required
proofs, plus: DB-level unique-index verification, unrelated-position
non-pausing, ambiguous-timeout parking, and readiness-stays-false-on-failed-
reconciliation.

Pre-existing TypeScript baseline: exactly one error existed before this phase
(`handoff.routes.ts:46`, a mongoose filter typing issue) which broke
`npm run build` and therefore every `npm run build && node --test` chain. It
was fixed with a type-only narrowing/assertion (identical runtime behavior).
Server now typechecks with **0 errors**; the pre-existing
`tests/massive.*.test.mjs` suite passes (9/9).

## Known limitations

- Alpaca's `GET /orders:by_client_order_id` path shape is exercised only via
  the mock; the live-paper path should be smoke-tested against Alpaca paper in
  Phase 2B before any scheduler exists.
- AI rate limits and market-clock caches are per-process (consistent with the
  existing codebase); no multi-instance coordination yet.
- `closePosition` submits a market close via Alpaca's DELETE endpoint; it is
  exposed on the interface but nothing calls it in Phase 2A.
- Session daily counters (`dailyTradeCount`, `dailyRealizedPnl`, drawdown) are
  persisted fields with no updater yet — they are wired in Phase 2B with the
  session-open reset.

## Deferred to Phase 2B (verbatim scope)

Strategy signal scheduling · five-minute bar evaluation · option contract
ranking · risk-based position sizing · broker submission triggered by signals ·
position monitoring · stops · profit targets · end-of-day flattening ·
automation dashboard · live trading (never in scope).
