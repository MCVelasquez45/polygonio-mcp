# Automation Phase 2B — Deterministic Decision Engine

Status: **implemented, awaiting review**. Branch: `feat/automation-phase-2b-decision-engine`
(stacked on the reviewed `feat/automation-phase-2a-safety`, PR #56).

Phase 2B builds the deterministic decision pipeline for the first automated
SPY options strategy. **It ends at a persisted approved/rejected order
intent.** No market signal can reach `broker.submitOrder()` — the processor
never imports a submission path, approved intents get the non-submittable
status `APPROVED_AWAITING_EXECUTION`, and even the Phase 2A `submitIntent`
refuses them (it only submits `CREATED` intents).

Pre-condition evidence (2026-07-13): the Alpaca paper smoke test
(`server/scripts/alpaca-paper-smoke.mjs`) passed all four proofs — submit with
deterministic `client_order_id` (ACCEPTED), retrieve by `client_order_id`,
cancel (CANCELLED), reconcile final status into the journal.

## Data flow

```
POST /sessions/:id/evaluate-bar (dev/test-gated)          [no scheduler in 2B]
        │
        ▼
closedBarProcessor.processClosedBar(sessionId, adapter, fixture?)
  1  session gates: READY · reconciliation CLEAN · no e-stop · automationReady
  2  bars ← fixture | resolveAggregates(SPY, 5m)      (shared market service)
  3  validateClosedBars: closed-only · fresh · history ≥ 30 · no session gaps
  4  bar newer than session.lastProcessedClosedBarTs (else DUPLICATE_SUPPRESSED)
  5  market clock (broker = authority; UNKNOWN/CLOSED → CLOCK_REJECTED)
  6  daily reset (exchange trading day via broker clock)
  7  indicators ← indicatorAdapter (VWAP/EMA9/EMA21/RSI14/volAvg/ATR)
  8  strategyEvaluator → BULLISH | BEARISH | NO_TRADE(+reasons)
  9  TradeCandidate persisted (unique bar key = the dedupe claim)
 10  chain ← fixture | getMassiveOptionsChain          (shared Massive service)
 11  optionSelector: deterministic filters + scoring → ContractSelection persisted
 12  riskEngine (pure, 18 checks, AI structurally excluded) → RiskDecision persisted
 13  approved → Phase 2A createOrderIntent (idempotent) → APPROVED_AWAITING_EXECUTION
 14  STOP. Zero broker submissions.
```

## Indicator definitions (`indicatorAdapter.service.ts`)

| Indicator | Definition | Source |
|---|---|---|
| VWAP | session-anchored Σ(typical×vol)/Σ(vol); typical=(H+L+C)/3; session boundary = gap > 3h | new (didn't exist server-side) |
| EMA 9 / EMA 21 | seeded from first close, k=2/(n+1) over full window | **reused** `computeEMA` (signalEngine) |
| RSI 14 | Wilder smoothing, SMA seed | **reused** `computeRSI` |
| ATR 14 | mean of last N true ranges | **reused** `computeATR` |
| Rolling volume avg | mean of previous 20 bar volumes, excluding the current bar | new |

The exact snapshot used for every candidate is persisted
(`tradeCandidate.indicatorSnapshot`). Tests assert exact values on
hand-computed fixtures (VWAP=12 on a 3-bar series, EMA(3)=2.25 on [1,2,3],
RSI=100 on monotonic rise) and window-bounded values on the strategy fixtures.

## Strategy conditions (momentum-5m-v1)

> Phase 2.6 renamed the strategy key from `spy-5m-momentum-v1` to
> `momentum-5m-v1`: the rules are unchanged but the engine is now
> symbol-agnostic — see
> [phase-2-6-configurable-universe.md](phase-2-6-configurable-universe.md).

Bullish (ALL): close>VWAP · EMA9>EMA21 · 50≤RSI≤70 · volume>1.0×avg(20) ·
no automation position · no unresolved automation order · dailyTradeCount<2.
Bearish mirrors with close<VWAP · EMA9<EMA21 · 30≤RSI≤50.
Anything else → `NO_TRADE` with per-condition reason codes
(`BULL_RSI_OUT_OF_RANGE`, `BEAR_CLOSE_NOT_BELOW_VWAP`, …). **No AI fallback;
no substitute rule logic** — verified by test 4 (trend passes, RSI=100 →
NO_TRADE, nothing downstream executes).

## Contract filters & scoring (`optionSelector.service.ts`)

Authority moved server-side; the React client is no longer in the automated
path (its AI endpoint stays advisory-only). Bullish→calls, bearish→puts.

Hard filters (defaults, env-overridable): DTE 7–21 · |Δ| 0.55–0.70 · OI ≥ 500 ·
volume ≥ 100 · spread ≤ 10% of mid · quote age ≤ 120s · bid>0 · ask>0 ·
ask≥bid · tradable≠false. Score = deltaCloseness(target 0.60, weight 4)
+ spreadTightness(≤$0.30→2, ≤$0.60→1) + liquidity(OI≥500→2/≥200→1, vol≥1000→1/≥250→0.5)
+ dteCentering(≤1) — the client `scoreLeg` weights, ported and extended.
Ties break by symbol for absolute determinism. Persisted per candidate:
quote timestamp, spread $ and %, every rejection reason, all score components;
`noSelectionReason` when nothing passes (full ranking still stored — test 14).

## Risk checks (order-evaluated, ALL recorded, no short-circuit)

mongoConnected · automationReady · reconciliationClean · emergencyStopInactive ·
marketOpen · underlyingBarFresh · contractSelected · optionQuoteFresh ·
spreadAcceptable · dailyLossWithinLimit · drawdownWithinLimit ·
tradesWithinDailyLimit · consecutiveLossCooldownInactive ·
noExistingAutomationPosition · noUnresolvedAutomationOrder ·
notDuplicateCandidate · sufficientBuyingPower · quantityAtLeastOne.

Inputs are a closed typed set (account, session, config, candidate, contract,
positions/orders counts, data health, clock, mongo/readiness, now). **AI output
is not an input**; test 28 proves injected AI fields change nothing, deep-equal.

## Position sizing

```
premiumCostPerContract = ask × 100
plannedLossPerContract = premiumCost × stopLossPct (0.5)
riskBudget             = equity × 0.25%
quantity = floor(riskBudget / plannedLossPerContract)
         capped by floor(buyingPower / premiumCost)
         capped by floor(equity × 5% / premiumCost)
```

Worked example (tests 22): equity 100k, BP 50k, ask 1.20 → 120 / 60 / 250 →
qty 4. Equity 10k → budget 25 < 60 → qty 0 → `RISK_QUANTITY_BELOW_ONE`.
All inputs and outputs persisted on the risk decision.

## Daily reset (`sessionDailyReset.service.ts`)

Trading date = broker-clock instant rendered in **America/New_York**
(`Intl.DateTimeFormat`), never server-local midnight. On date change: zero
dailyTradeCount/dailyRealizedPnl/consecutiveLossCount, capture
startingDayEquity, set dailyLossBudget = 0.75% of it, stamp
lastResetTradingDate. Test 27 proves 22:00 ET (02:00 UTC next day) does NOT
reset and the next exchange morning does.

## Reason-code catalog

Complete catalog in `automation.config.ts` (`REASON`): data gates (STALE_BAR,
INSUFFICIENT_BAR_HISTORY, BAR_GAP_DETECTED, BAR_NOT_NEWER_THAN_LAST_PROCESSED…),
clock (MARKET_CLOCK_UNKNOWN, MARKET_CLOSED, CLOCK_CONFLICT), session gates,
8 per-direction strategy codes, 12 contract-selection codes, 18 RISK_* codes.
Every persisted decision carries verbatim codes + timestamps (test 29).

## API

| Endpoint | Notes |
|---|---|
| `GET /api/automation/sessions/:id/candidates` | trade candidates, newest bar first |
| `GET /api/automation/sessions/:id/contract-selections` | full rankings |
| `GET /api/automation/sessions/:id/risk-decisions` | checks + sizing |
| `POST /api/automation/sessions/:id/evaluate-bar` | **disabled unless** `NODE_ENV=test` or `AUTOMATION_EVALUATE_BAR_ENABLED=true`; `fixture` bodies additionally require `AUTOMATION_ALLOW_FIXTURES=true`. Clients can never inject indicator values — indicators are always computed server-side from bars. |

```bash
curl -s -X POST localhost:4000/api/automation/sessions/<id>/evaluate-bar \
  -H 'content-type: application/json' -d '{}' | jq        # live data path (dev-gated)
curl -s localhost:4000/api/automation/sessions/<id>/candidates | jq
curl -s localhost:4000/api/automation/sessions/<id>/contract-selections | jq '.[0].selected'
curl -s localhost:4000/api/automation/sessions/<id>/risk-decisions | jq '.[0].checks'
```

## Hardening found during testing

Mongoose builds unique indexes asynchronously; under load an insert could
precede index creation and bypass E11000 dedupe. Fixes: (1)
`initializeAutomation` now awaits `Model.init()` for all seven automation
models before readiness — the unique constraints are load-bearing; (2) the
candidate writer does a findOne-first duplicate check so sequential dedupe
never depends on index timing. Verified: 6 consecutive full-suite runs, 68/68.

## Test report

`npm run test:automation` → **68/68** (six consecutive clean runs) ·
existing `massive` suite 9/9 · `tsc` 0 errors. Coverage matrix in the review
summary; both required integration fixtures implemented
(approved: bullish → calls ranked → selected → risk approved → ONE intent →
ZERO submissions; rejected: daily-loss breach → risk rejected → no intent).

## Known limitations

- Live (non-fixture) evaluate-bar depends on Massive intraday aggregates being
  available under the current plan; the resolver's health block is persisted on
  the candidate either way.
- Per-leg quote timestamps aren't always present in chain snapshots; the chain
  fetch time is then the normalized quote timestamp (documented in code).
- `openAutomationPositions` counts SUBMITTED automation intents (no fill
  tracking until 2C); broker-side position truth is enforced separately by
  reconciliation pausing sessions on orphans.

## Deferred to Phase 2C (verbatim)

Automatic scheduler startup · signal-triggered broker submission · broker fill
polling loop · position monitoring · stop-loss execution · profit-taking
execution · end-of-day flattening · automation dashboard · live trading (never).
