# Intelligence Workspace Design System

The token + component contract for the AI-Trader V2 Intelligence workspace
redesign. Full rationale lives in the
[Intelligence Workspace Design Audit](./intelligence-workspace-design-audit.md);
this file is the implementation reference.

## Principle

The backend already emits the narrative layer (executive summaries, primary
lessons, grade rubrics, 12 analytics dimensions). The UI's job is to surface it
in one order on every intelligence page:

> **Hero Summary → Key Metrics → Insights → Evidence → Timeline → Raw Data**

Everything from *Evidence* down is collapsed by default (`<Panel collapsible>`).

For active trading surfaces, the operator scans before reading. The visual order
is:

> **State → Direction → Urgency → Confidence → Action → Detail → Evidence**

The interface should communicate live/stale, bullish/bearish, warning/healthy,
AI-recommended, selected, and unavailable states before the operator reads body
copy.

## Color

Defined as `intel.*` tokens in `client/tailwind.config.js`.

| Token | Hex | Role |
| --- | --- | --- |
| `intel-bg` | `#020617` | ground (matches app slate-950) |
| `intel-panel` | `#0b1220` | raised surface |
| `intel-panel2` | `#111a2b` | secondary / hover |
| `intel-line` / `intel-lineSoft` | `#1e293b` / `#162032` | hairline / faint divider |
| `intel-ink` / `ink2` / `ink3` | `#e9edf6` / `#94a3b8` / `#64748b` | text hierarchy |
| `intel-accent` | `#f5a623` | restrained chrome and legacy terminal accent |
| `intel-pos` / `neg` / `warn` | `#35d29a` / `#f87171` / `#fbbf24` | semantic state: bullish/healthy/executed, bearish/failed/risk, warning/pending |
| `intel-info` | `#6aa5f5` | live data, streaming, selected row/object, active position |
| `intel-ai` | TBD | AI recommendation, GPT analysis, intelligence overlay |
| `intel-muted` | TBD | inactive, unavailable, historical, disabled |

**Rule:** color is semantic and must be consistent. Green is bullish, long,
healthy, executed, filled, or favorable. Red is bearish, short, rejected,
stopped, failed, or dangerous. Amber is caution, attention, or pending. Blue is
live market data, streaming, selected, or active. Purple is the AI/intelligence
layer. Gray is inactive, unavailable, historical, or disabled.

Do not use color randomly, and do not rely on color alone. Every semantic color
needs a companion cue: icon, text label, shape, border, tooltip, or accessible
status label.

## Type

- **Monospace** (`font-mono`, system stack — CSP-safe) carries every number,
  id, label, and metric, always with `tabular-nums`.
- System sans carries headings and prose.
- Uppercase labels use `tracking-label` (0.16em); eyebrows `tracking-eyebrow`.

## Empty-state vocabulary

One voice, chosen by data class (see `lib/intelligenceFormat.ts`):

| Situation | Rendering |
| --- | --- |
| Absent inline scalar | `—` (em dash — never a fake `0`) |
| Empty whole panel | `EMPTY.panel(noun)` → "Nothing to show — the engine logged no {noun}." |
| Truncated list | `<EventList>` → "Showing X of Y — show all" (never a silent `slice`) |

## Primitives

Location: `client/src/components/intelligence/ui/` (barrel `index.ts`).

| Component | Replaces | Purpose |
| --- | --- | --- |
| `Panel` | 5× local `Section` | titled card; `collapsible` demotes below-fold content |
| `Metric` / `MetricStrip` | 5× local `Stat` | seamless read-out grid |
| `Badge` / `GradeBadge` | 5× ad-hoc badges | tone-driven pills |
| `HeroBand` | — | the "what happened" band opening each detail view |
| `EventList` | 4× silent `slice()` | bounded list with "show all" |
| `RecordList` | 5× inline selectors | accessible list→detail sidebar |

Additional scan-first workstation primitives:

| Component | Purpose |
| --- | --- |
| `SemanticStatusBadge` | consistent live/snapshot/stale/pending/failed/rejected/filled/healthy status |
| `DirectionBadge` | bullish/bearish/neutral/long/short cue with icon and color |
| `ConfidenceMeter` | compact confidence bar or radial indicator |
| `RiskMeter` | low/medium/high/critical risk indicator |
| `QuoteFlash` | restrained bid/ask/last update pulse for live price changes |
| `LivePulse` | heartbeat/live-stream pulse with reduced-motion fallback |
| `AIRecommendationBadge` | purple AI watching/recommended/generated marker |
| `InstrumentCard` | cockpit-style active-position card |
| `ScannerSignalCard` | actionable scanner result tile |
| `OptionMoneynessBand` | ITM/ATM/OTM/deep-moneyness encoding |

Formatters + tone helpers: `client/src/lib/intelligenceFormat.ts` (consolidates
the per-page `formatMoney` / `formatPercent` / `gradeTone` copies).

## Rollout

1. **Foundation** — tokens, format lib, primitives *(done)*.
2. Trade + Daily reports onto the story arc.
3. Decision desk: summary tiles + filter bar + virtualized table.
4. Analytics visualization (Recharts, already a dependency).
5. Sessions + workspace shell (left rail, date/env scope, Command Center).
6. Scan-first workstation pass: watchlist scanner rows, option-chain moneyness,
   position instruments, automation status strip, scanner signal cards, and
   quote-change motion.
