# Portfolio Command Center

The Portfolio page is the single operational surface for automation — there is
no separate automation dashboard. It joins **broker truth** (Alpaca paper) with
**automation context** (sessions, intents, positions, risk, timeline) on the
server so the UI never correlates unrelated records.

## API — `/api/portfolio`

| Method | Path | Purpose |
|---|---|---|
| GET | `/operations` | full aggregation: brokerTruth, automationContext, manualBrokerActivity, health, risk |
| GET | `/positions` | broker positions annotated with ownership + automation detail |
| GET | `/orders` | broker orders annotated with intent context |
| GET | `/automation` | sessions + health + per-session risk |
| GET | `/timeline/:sessionId` | persisted automation events (never fabricated) |
| GET | `/trades` | closed automation trades with realized outcomes |
| POST | `/automation/pause` | pause new entries (durable) |
| POST | `/automation/resume` | resume only when all health gates pass |
| POST | `/automation/emergency-stop` | emergency stop + begin exit lifecycle |
| POST | `/orders/:id/cancel` | cancel an automation-owned pending order (intent id) |
| POST | `/positions/:id/close` | close an automation-owned position (durable EXIT intent) |

## Ownership

A broker position/order is `AUTOMATION` **only** when a persisted link proves
it: an `AutomationPosition` for the option symbol, or an `OrderIntent` whose
`client_order_id` matches the broker order. Everything else is `MANUAL` and is
shown but never managed by automation. The aggregation response separates
`brokerTruth`, `automationContext`, and `manualBrokerActivity` explicitly.

## Controls

Every control routes through durable state or the broker adapter — the UI never
calls Alpaca directly. `pause`/`resume`/`emergency-stop` mutate the session;
`cancel`/`close` go through the broker adapter / the durable EXIT intent path
(`OPERATOR_CLOSE`). Resume is refused while emergency stop is active, while
reconciliation is not CLEAN, or while health gates fail. Emergency stop sets the
session `EMERGENCY_STOPPED` and immediately submits highest-priority exits for
all open positions.

## Panels the page presents

Account summary (buying power / equity / cash / net unrealized / daily realized
/ trades today) · automation status (mode, running/paused, market open, next
open, entry-window/cutoff/flatten, data + broker-stream health, reconciliation,
universe, last decision) · open positions (manual + automation together, with
source, strategy, stop/target, monitoring status) · active orders (intent +
broker status) · lifecycle timeline (from persisted events) · closed automation
trades (realized P&L, return %, exit reason, win/loss) · controls (pause,
resume, cancel, close, emergency-stop) with confirmation on destructive actions.
