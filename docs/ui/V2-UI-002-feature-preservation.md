# V2-UI-002 — Feature Preservation Matrix

Presentation-layer alignment. **Nothing was removed.** Every enterprise
capability remains reachable; this table records where each now lives and at
what disclosure level.

Levels: **PRIMARY** (default operator surface) · **CONTEXTUAL** (appears when a
symbol/position/trade is selected) · **ADVANCED** (behind a collapsible section)
· **DIAGNOSTIC** (in the Diagnostics drawer / System Ops) · **HISTORICAL** (in
the Review workspace).

| Capability | Before | After — location | Level |
| --- | --- | --- | --- |
| Terminal / chart | `trading` view | Trade workspace (renamed rail label) | PRIMARY |
| Watchlist | Sidebar | Trade workspace sidebar | PRIMARY |
| Options matrix / chain | trading grid | Trade workspace (centers on active contract when Linked) | PRIMARY / CONTEXTUAL |
| Order ticket | trading grid | Trade workspace right rail | PRIMARY |
| AI summary (desk insight) | trading grid | Trade workspace | PRIMARY |
| Greeks (contract analysis) | always-open panel | Trade workspace — **collapsible** "Greeks & contract analysis" | ADVANCED |
| Scanner | always-open full-width | Trade workspace — **collapsible** "Scanner" | ADVANCED |
| Positions blotter + book summary | `portfolio` view | Positions workspace | PRIMARY |
| **Per-position management** (bid/ask/mid/spread, Greeks, working orders, IV/OI, DTE, break-even) | scattered / close-only | **Position Manager** panel (select a row) | CONTEXTUAL |
| Close position / cancel order | portfolio blotter | unchanged (canonical path) | PRIMARY |
| Automation supervision (strategy, recommendation, today's results, health, recent actions) | Cockpit | Automation workspace default | PRIMARY |
| Scheduler / monitor / queue telemetry | Cockpit (always open) | Automation — **collapsible** "Engineering diagnostics" + Diagnostics drawer | DIAGNOSTIC |
| Trade lifecycle | Cockpit | Automation workspace | PRIMARY |
| Learning intelligence | Cockpit only | Automation **and** Review workspace (Learning tab) | PRIMARY / HISTORICAL |
| Risk engine | Cockpit / portfolio | Automation + per-position risk in Position Manager | PRIMARY / CONTEXTUAL |
| AI Desk (verdict → full analysis) | ChatDock | ChatDock (verdict-first, "View Full Analysis") | PRIMARY |
| Daily reports · Trade reports · Decision journal · Strategy analytics · Sessions | Intelligence tabs | Review workspace tabs | HISTORICAL |
| System status (7 badges) | permanent badge row | **compact System control** + popover | PRIMARY |
| Backend / broker / Massive / WS / Mongo / AI / automation health | badge row | System control popover **and** Diagnostics drawer | PRIMARY / DIAGNOSTIC |
| Data health · engine room · logs · lease · cache · latency · heartbeats | System Ops page | Diagnostics drawer (reuses System Ops) + System Ops view | DIAGNOSTIC |
| Operator activity timeline | mixed with heartbeats | Command Center — operator-only feed | PRIMARY |
| Engineering event log | mixed feed | Diagnostics drawer live logs | DIAGNOSTIC |

## Navigation — before vs after

**Before (rail):** Terminal · Positions · Automation · Intelligence — + System Ops (secondary)
**After (rail):** Trade · Positions · Automation · Review — + System Ops (secondary) + **Diagnostics drawer** (from the System status control, reachable from every workspace)

Internal view ids (`trading` · `portfolio` · `cockpit` · `intelligence` ·
`operations`) are unchanged, so all deep links and view behavior are preserved.
