## Phase 2C — Live-Data Automated Paper Trading & Portfolio Command Center

Connects the deterministic decision engine to real execution: a complete
paper-options lifecycle on **live Massive options data** + **Alpaca paper-broker
truth**. Nothing in normal runtime is simulated. **Draft — do not merge/deploy.**

> Stacked on `fix/options-advanced-market-data-alignment`; includes the Phase
> 2.6 configurable-universe baseline commit + the Phase 2C commit.

### 1. File-by-file change report

**New — server**
- `services/optionsFlowSignal.service.ts` — options-native signal engine (data-blocker fix): pure feature/direction engine + snapshot-diff window builder.
- `services/marketSession.service.ts` — market-hours phase policy from the authoritative broker clock.
- `services/exitEngine.service.ts` — deterministic priority-ranked exit triggers.
- `services/riskAccounting.service.ts` — broker-truth realized-P&L + counter feedback loop (idempotent).
- `services/positionManager.service.ts` — position lifecycle (entry fill → OPEN → exit → CLOSED).
- `services/entryExecution.service.ts` — approved-entry submission wiring + deterministic limit-price policy.
- `automation.scheduler.ts` — market-hours tick (entries/cancel/monitor/flatten) + emergency flatten.
- `models/automationPosition.model.ts` — durable lifecycle-linked position record.
- `models/schedulerLease.model.ts` — DB-backed single-owner scheduler lease.
- `features/portfolio/{portfolio.service,portfolio.controller,portfolio.routes}.ts` — command-center aggregation + controls.

**Modified — server**
- `automation.config.ts` — Phase 2C env (signal mode, flow windows, cutoffs, exit policy, limit policy) + `validateAutomationConfig` startup gate + reason codes.
- `models/automationSession.model.ts` — peak equity / max drawdown / last-trade fields.
- `services/orderIntent.service.ts` — `APPROVED_AWAITING_EXECUTION` is now submittable; EXIT intents allowed on paused/emergency sessions.
- `services/universeTickProcessor.service.ts` — entry intent uses the configurable limit policy.
- `services/sessionRecovery.service.ts` — new-model index init, config-validation gate, production mock refusal.
- `services/mockPaperBrokerAdapter.service.ts` — poll-fill position book + market-fill price (test double only).
- `index.ts` — mount `/api/portfolio`.

**New/modified — client**
- `api/portfolio.ts` (+ `api/index.ts`) — command-center client API.
- `components/portfolio/AutomationCommandCenter.tsx` — automation status + risk + controls, embedded in `PortfolioPanel.tsx`.

**Docs** — `phase-2c-live-paper-execution.md`, `portfolio-command-center.md`, `market-hours-runbook.md`, `paper-trading-operations-runbook.md`.

### 2. Runtime mock-removal report
- Mock broker is opt-in only (`AUTOMATION_BROKER=mock`), defaults to real Alpaca paper, and is **refused in production** by both config validation and a defensive guard in `resolveBrokerAdapter`.
- No `Math.random`/synthetic prices/fabricated fills in any automation runtime path (grep-verified). Fills come only from `recordBrokerOrderSnapshot`, which rejects any payload without broker identity.
- Mocks/fixtures remain for tests only. Lab simulator untouched and isolated.

### 3. Market-hours enforcement report
Phases derive from the authoritative broker clock `next_close` (holiday/early-close aware): `PRE_CUTOFF` (entries) → `POST_ENTRY_CUTOFF` (45m) → `CANCEL_ENTRIES` (20m) → `FLATTEN` (15m) → `CLOSED`. No new entries after cutoff; unfilled entries cancelled; all positions flattened before close; no intentional overnight positions. Single-owner DB lease prevents duplicate submission.

### 4. Order/fill lifecycle report
Approved intent → `submitIntent` (persist-then-act, idempotent client_order_id, ambiguous-failure parking) → broker order → partial/full fills advance qty/avg price, never regress terminal states → position OPEN. Deterministic entry limit price (MID default) from bid/ask, slippage-capped, timeout→cancel.

### 5. Risk-feedback report
On broker-confirmed close: `realizedPnl = exitProceeds − entryCost` updates `dailyRealizedPnl`, `dailyTradeCount`, `consecutiveLossCount` (WIN→0/LOSS→+1/BREAKEVEN→unchanged), `peakEquity`, `currentDrawdown`, `maxDrawdown` — atomically, once (idempotent `riskCounted`). Proven that updated counters block the next risk decision (consecutive-loss cooldown). Realized paper P&L currently uses broker-confirmed entry/exit prices; the integration does not yet ingest a separate commission or regulatory-fee source, so fee fields default to zero until such a source is implemented (see §12).

### 6. Portfolio integration report
`/api/portfolio/operations` joins broker truth with automation context; ownership proven by persisted `client_order_id` / position links (manual positions shown, never managed). Controls (pause/resume/emergency-stop/cancel/close) route through durable intents / the broker adapter — never Alpaca directly. Embedded command-center panel in the existing Portfolio page.

### 7. Test-to-requirement matrix (selected)
| Req | Test |
|---|---|
| Options-native signal / balanced→NO_TRADE / stale→DATA_REJECTED | `automation2c.signal.test.mjs` |
| Market closed / cutoff / cancel / flatten / early close (§17.1–7) | `automation2c.marketsession.test.mjs` + lifecycle |
| One submission, no duplicate, idempotent (§17.10–11) | `automation2c.lifecycle.test.mjs` |
| Partial/aggregate fills, no regression (§17.16–19) | `automation2c.lifecycle.test.mjs` |
| Stop/target/emergency/EOD priority, one exit (§17.21–26) | `automation2c.exit.test.mjs` + lifecycle |
| Data outage blocks price exits (§17.28) | `automation2c.lifecycle.test.mjs` |
| Win/loss counters, no double-count, next-decision (§17.29–36) | `automation2c.riskfeedback.test.mjs` |
| Ownership classification, emergency control (§17.37–43) | `automation2c.lifecycle.test.mjs` |
| Prod mock refusal, no synthetic bars, no fake fills (§17.45–48) | `automation2c.authenticity.test.mjs` |
| Scheduler single-owner lease (§17.9) | `automation2c.lifecycle.test.mjs` |
| E2E lifecycle proof | `automation2c.lifecycle.test.mjs` |
| 2A/2B/alignment/universe green (§17.49–52) | full suite |

### 8/9. Test results
`196 pass / 0 fail` (automation + marketdata + massive), incl. 72 new Phase 2C tests.

### 10. TypeScript build
`npm run build` (server tsc) clean. New client TS files type-clean (pre-existing unrelated client tsc errors remain, unaffected; Vite/esbuild runtime unaffected).

### 11. Real Alpaca paper smoke test
**Not run** — requires live Alpaca paper credentials and an open market session; must not place forced orders in review. Procedure documented in `paper-trading-operations-runbook.md` (market-hours only, cancel-if-unfilled, no risk bypass).

### 12. Known limitations
- **Live options-flow sampling** requires a baseline chain snapshot across ticks; the evaluation scheduler's live `entryEvaluator` (Massive wiring) is the remaining integration seam — the pure engine + snapshot-diff builder are complete and tested, and the tick composition is proven with the mock broker. First window after restart is skipped (no baseline).
- **Single concurrent position.** The autonomous lifecycle is validated and supported for exactly one open automation position; startup **fails closed** if `AUTOMATION_MAX_CONCURRENT_POSITIONS ≠ 1`. Exit identity is already position-scoped, so multi-position is a future, explicitly-designed sprint — not a hidden coupling.
- **Live commission/exchange fees** are not folded into realized P&L yet (paper fees are `0`, so paper accounting is exact); `entryFees`/`exitFees` fields are ready for a live source.
- **Live option-mark provider** locates the held contract inside the entitled chain fetch; if the contract's DTE drifts outside the configured chain window the mark returns stale (price triggers suppressed) until EOD flatten. Positions are short-dated and flattened intraday, so this is bounded.
- V1 exits in full (partial-then-terminal exits escalate to `MANUAL_REVIEW` rather than auto-retrying); trailing stops disabled by default.
- Real-paper smoke not executed (see §11).
- Portfolio UI is a focused command-center panel (status/risk/controls/ownership); full timeline/closed-trade tables consume endpoints that exist but have lighter UI.

### 12a. Phase 2C finalization (production hardening) — delta
- **Monitoring scheduler wired.** `monitorController.service.ts` drives the post-fill lifecycle (stop-loss, profit-target, cancel-unfilled, `EXITING` reconciliation, EOD flatten) on its own single-owner lease (`automation-monitor`), started in `index.ts` alongside the evaluation scheduler and stopped on shutdown. The prior "scheduler interval not wired" limitation is **closed**.
- **`EXITING` state machine completed.** Retry (bounded) / continue / escalate-to-`MANUAL_REVIEW` on every broker outcome; a position is never orphaned. Position-and-attempt-scoped exit `client_order_id`.
- **Monitoring heartbeat.** Structured `MONITOR_HEARTBEAT` every tick (lease/Mongo/broker/truth/phase/position-health). No console logging.
- **Config guard.** `AUTOMATION_MAX_CONCURRENT_POSITIONS ≠ 1` fails config validation at startup.
- **Tests.** +2 files (`automation2c.exitrecovery.test.mjs`, `automation2c.monitor.test.mjs`); full suite **262 pass / 0 fail**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
