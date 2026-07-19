# Execution Boundary — Research · Manual · Automated

Three explicit operating surfaces. Each has a different authority; none can
borrow another's. Execution authority is **always explicit** — never inferred
from a client-order-id prefix, route, component, screen, or environment.

```
                        MARKET DATA (Massive / MCP)
                                  │  read-only
                                  ▼
                          Options Research
                    (chains, quotes, Greeks, GPT analysis)
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                  ▼
        Manual Order Ticket                 Automation Evaluation
                 │                                  │
        Explicit User Confirmation         Deterministic Risk Decision
                 │                                  │
        Durable MANUAL intent              Approved AUTOMATION intent
         (create → confirm)                (scheduler + risk + lease)
                 │                                  │
                 └───────────────┬──────────────────┘
                                 ▼
                     Execution Gateway (fail closed)
                                 ▼
                          Broker Adapter → Alpaca Paper → Broker Truth
```

## 1. Research (read-only)

Loading/refreshing chains, viewing/selecting a contract, expiration/strike/side
changes, quote and WebSocket updates, GPT analysis, and Massive/MCP market-data
calls **never** submit a broker order. Research controllers and the market-data
services do not import the broker submission path. The browser may hold an
order-shaped *preview* object for display; it carries no execution authority.

## 2. Manual paper trading (explicit confirmation)

A user builds an order in the ticket, opens the review dialog, and clicks
**Submit Manual Paper Order** — the only action that submits. Submission is a
durable, governed lifecycle:

```
POST /api/trading/manual/intents          → CREATED   (durable draft; no broker call)
POST /api/trading/manual/intents/:id/confirm → CONFIRMED (explicit confirmation)
POST /api/trading/manual/intents/:id/submit  → SUBMITTED (execution gateway → broker)
```

- Selecting a contract only updates local state. Nothing submits from
  `useEffect`, mount, quote refresh, chain refresh, modal open, or analysis.
- Submission is **idempotent**: a re-submit returns the existing broker order;
  concurrent double-clicks resolve to exactly one broker order (atomic
  `CONFIRMED → SUBMITTING` claim).
- The confirmed **payload hash** is re-checked at submit; a changed payload is
  rejected.

## 3. Automated paper trading (deterministic engine)

Unchanged and fully autonomous. Approved automation intents flow through the
evaluation scheduler → risk engine → execution → broker → reconciliation →
monitoring. Automation **never** uses the manual gateway (it is explicitly
rejected there) and **never** requires user confirmation. GPT is advisory only:
its output alone can neither create an approved intent nor submit an order.

## Execution Gateway

All manual submissions pass `authorizeManualSubmission` (pure, fail closed).
It rejects, in order:

| Reason | Meaning |
|---|---|
| `MISSING/INVALID_EXECUTION_MODE` | mode absent or not `MANUAL`/`AUTOMATED` |
| `MISSING/INVALID_ORDER_SOURCE` | source absent or not `MANUAL_UI`/`AUTOMATION_ENGINE` |
| `AUTOMATION_MUST_USE_ENGINE_PATH` | automation may not submit via the manual gateway |
| `MODE_SOURCE_MISMATCH` | mode/source inconsistent |
| `MISSING_AUTHORIZATION_ID` | no confirmed manual-intent id |
| `MISSING_IDEMPOTENCY_KEY` | no deterministic client-order id |
| `MANUAL_INTENT_NOT_CONFIRMED` | intent not explicitly confirmed |
| `PAYLOAD_CHANGED_SINCE_CONFIRMATION` | order changed after confirmation |
| `MANUAL_TRADING_DISABLED` | `MANUAL_TRADING_ENABLED=false` kill switch |
| `MONGO_UNAVAILABLE` | durable store down |
| `MARKET_CLOCK_UNAVAILABLE` | broker clock truth unavailable |

A missing mode is **never** defaulted to `MANUAL` or `AUTOMATED` — it is rejected.

## Client order IDs

Client order IDs are correlation identities, **not** authorization. They are
deterministic and mode-scoped:

- Manual: `manual-<sha256(intentId:attempt)[:32]>`
- Automation entry: intent idempotency key (`at2a-…`); exits are position- and
  attempt-scoped (`exit:{positionId}:{attempt}`).

The former ad-hoc `mcp-${Date.now()}` id (non-deterministic, un-idempotent, and
the marker of the accidental-submission defect) is removed from the execution
path.

## Fail-closed summary

No order reaches Alpaca unless: an explicit governed intent exists (manual:
confirmed durable intent; automation: risk-approved intent), the deterministic
client-order id is present, and infrastructure is healthy (Mongo up, broker
clock available, manual kill switch on / automation gates satisfied). The
legacy direct route `POST /api/broker/alpaca/options/orders` is disabled
(HTTP 410) so no research/selection payload can reach the broker.
