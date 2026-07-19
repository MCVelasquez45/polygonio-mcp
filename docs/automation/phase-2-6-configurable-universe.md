# Phase 2.6 — Configurable Options Trading Universe

The automation engine is now **completely symbol-agnostic**. Trading
candidates come from configuration, never from source code: no ticker symbol
appears anywhere in `server/src/features/automation/`.

## Configuration

```env
# Comma-separated optionable underlyings — the ONLY source of automation symbols.
AUTOMATION_UNDERLYINGS=SPY,QQQ,USO,XLE,XOM,CVX,OXY

# Legacy single-symbol fallback (used only when AUTOMATION_UNDERLYINGS is unset)
# AUTOMATION_UNDERLYING=SPY
```

- Parsing is deterministic: trim → uppercase → dedupe (first occurrence wins)
  → validate against `^[A-Z][A-Z.]{0,9}$`. Invalid entries are recorded
  (`UNIVERSE_SYMBOL_INVALID`) and skipped.
- **There is no in-code default list.** An unconfigured universe is empty and
  every evaluation records `UNIVERSE_NOT_CONFIGURED` instead of trading.
- A session may carry its own `universe: string[]` override (set at creation
  via `POST /api/automation/sessions`); otherwise the env universe is resolved
  at evaluation time, so editing `.env` requires no code changes.
- Adding or removing a symbol (including SPY) is a configuration-only change —
  proven by tests.

## Architecture

```
resolveUniverse (session override → AUTOMATION_UNDERLYINGS → legacy env)
        │
        ▼            marketUniverse.service.ts
per-symbol validation ────────────────────────────────
  bars: available · authorized (Options Advanced gate) · fresh · complete
  chain: window completeness · ≥1 liquid contract (spread/OI/volume/quote age)
  failures → reason codes, symbol SKIPPED, run continues
        │
        ▼            universeTickProcessor.service.ts
per-symbol strategy (identical momentum-5m-v1 rules for every symbol)
  → per-symbol candidate persisted (unique per session+symbol+bar)
  → per-symbol contract selection (existing deterministic selector)
        │
        ▼
deterministic opportunity ranking
  opportunityScore = contractScore × 10 + symbolScore; tiebreak: symbol asc
  ranking persisted on automation_universe_evaluations
        │
        ▼
risk engine on the highest-ranked opportunity
  contract-specific rejection (stale quote / spread / no contract) → try next rank
  session-level rejection (loss limits, positions, …) → stop, applies to all
        │
        ▼
ONE APPROVED_AWAITING_EXECUTION intent — or NO_TRADE. Never a submission.
```

Key services:

| File | Responsibility |
|---|---|
| `services/marketUniverse.service.ts` | universe resolution, per-symbol data/chain/liquidity validation, deterministic symbol scoring + ranking |
| `services/universeTickProcessor.service.ts` | the multi-symbol pipeline: gates → per-symbol evaluation → opportunity ranking → risk → single intent |
| `models/universeEvaluation.model.ts` | one document per run: configured/invalid/eligible symbols, per-symbol reasons, persisted ranking, selection, risk status |

## Symbol validation (before any strategy evaluation)

Every configured symbol must pass, in order — any failure records the reason
and skips the symbol without failing the run:

1. authorized real-time underlying bars (Options Advanced alignment gates:
   `UNDERLYING_DATA_UNAUTHORIZED` / `UNDERLYING_DATA_NOT_REALTIME`)
2. bar availability, freshness, history, continuity (existing 2B validation)
3. option-chain fetch for both sides of the configured DTE window
   (`SYMBOL_CHAIN_UNAVAILABLE`)
4. chain window completeness (`CHAIN_INCOMPLETE` — fail-closed on pagination)
5. at least one contract passing the liquidity screen: positive two-sided
   quote, spread ≤ `AUTOMATION_MAX_SPREAD_PCT`, OI ≥
   `AUTOMATION_MIN_OPEN_INTEREST`, volume ≥ `AUTOMATION_MIN_DAILY_VOLUME`,
   quote age ≤ `AUTOMATION_QUOTE_MAX_AGE_MS` (`SYMBOL_CHAIN_ILLIQUID`)

Market-open and automation-readiness are checked once per tick (they are
session-wide facts) and recorded on the evaluation document.

## Deterministic ranking

- **Symbol score** (0–8): liquid-contract count, best spread bucket, total OI
  bucket, total volume bucket, bar freshness. Threshold buckets, not raw
  floats — identical inputs always produce identical rankings.
- **Opportunity score**: the selected contract's deterministic score
  (delta-target/spread/liquidity/DTE, from Phase 2B) × 10 + symbol score.
- Absolute tiebreak: symbol ascending. The full ranking is persisted verbatim.

## API (dashboard surface)

| Endpoint | Purpose |
|---|---|
| `GET /api/automation/universe` | current configured universe + invalid entries + source |
| `GET /api/automation/sessions/:id/universe-evaluations` | persisted runs: eligible symbols, rejected symbols with reasons, ranked opportunities, selected symbol/contract, data health, risk status |
| `POST /api/automation/sessions/:id/evaluate-universe` | guarded evaluation (same `AUTOMATION_EVALUATE_BAR_ENABLED` + fixture gates as evaluate-bar) |
| `POST /api/automation/sessions` | now accepts `universe: string[]` (or the legacy single `underlying`) |

No SPY-specific automation widgets existed in the client; these endpoints are
the authoritative dashboard data source.

## Invariants carried forward

- **No broker submission** — the universe processor never imports
  `submitIntent`; adapter calls are read-only (clock, account). Execution
  remains Phase 2C.
- Per-symbol closed-bar dedupe: the Phase 2B unique index
  `(session, strategyVersion, underlying, bar)` plus a per-symbol
  `lastProcessedBars` cursor on the session.
- Fail-closed everywhere: unauthorized/delayed underlying data, incomplete
  chains, unknown market clock → recorded rejection, never a trade.
- Strategy key renamed `spy-5m-momentum-v1` → `momentum-5m-v1` (rules
  unchanged; the key no longer implies a symbol).

## Tests

`server/tests/automation26.universe.test.mjs` (22 tests): multi-symbol
evaluation, missing-data skip, incomplete-chain skip, liquidity
disqualification, deterministic ranking + alphabetical tiebreak,
RANKED_NOT_SELECTED persistence, same strategy on any ticker (bearish puts on
CVX, bullish calls on a novel symbol), unconfigured universe, gate rejection,
session-level risk stop (no cascade), per-symbol idempotency, dashboard
payload completeness, pure parsing/ranking. Run with
`npm run test:automation`.
