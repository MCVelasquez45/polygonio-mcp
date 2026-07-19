# Intelligence Workspace Design Audit

## V2 Revision: Scan-First Trading Desk UX

This revision preserves the Information Architecture from the original audit:

- Trading answers: What should I trade?
- Portfolio answers: What do I own?
- Cockpit answers: What should I do with this position?
- Intelligence answers: What happened?
- System Operations answers: Why is the platform unhealthy?

The missing product principle is that a trader scans the interface before reading it. The workstation must communicate state, urgency, direction, confidence, and opportunity through pre-attentive cues: color, position, density, iconography, grouping, motion, and contrast. Text remains important, but text should confirm what the eye already understands.

## Product Stance

This is not an executive analytics dashboard. It is an active institutional trading workstation.

Target references:

- Bloomberg Terminal
- ThinkOrSwim
- TradingView
- Bookmap
- Interactive Brokers TWS
- BlackRock Aladdin
- Professional options desks

The correct feel is a live market desk: dense, fast, instrumented, semantically colored, and action-oriented. The incorrect feel is a SaaS reporting surface where every card has equal weight and every state must be read.

## Revised Visual Hierarchy

The previous narrative order remains valid for Intelligence pages:

> Hero Summary -> Key Metrics -> Insights -> Evidence -> Timeline -> Raw Data

For active trading workspaces, the scan hierarchy is different:

> State -> Direction -> Urgency -> Confidence -> Action -> Detail -> Evidence

This means each surface should answer visually, in this order:

1. Is this live, stale, pending, failed, or historical?
2. Is the bias bullish, bearish, neutral, or unavailable?
3. Does this need attention now?
4. How strong is the signal or confidence?
5. What action is available?
6. What details explain the state?
7. What raw evidence supports it?

## Color Semantics

Color is a semantic language, not decoration.

| Color | Meaning | Use |
| --- | --- | --- |
| Green | Bullish, long, healthy, filled, executed, high confidence | Long position badges, bullish scanner cards, fills, healthy automation, positive confidence |
| Red | Bearish, short, rejected, failed, stopped, high risk | Bearish bias, rejected trades, failed orders, stop conditions, critical risk |
| Amber | Warning, attention, pending, caution | Pending orders, market caution, spread caution, review-needed states |
| Blue | Live market data, streaming, selected, active position | Live quote badges, selected chain row, active contract, streaming status |
| Purple | AI/intelligence layer, GPT analysis, recommendation | AI watched symbols, AI recommended contracts, generated analysis |
| Gray | Inactive, unavailable, historical, disabled | Closed sessions, unavailable metrics, historical records |

Rules:

- Never use green only for P/L. Green also means bullish, long, healthy, executed, or confident.
- Never use red only for P/L. Red also means bearish, rejected, stopped, failed, or dangerous.
- Amber is attention and caution, not the universal accent.
- Blue is the live-market and selected-object channel.
- Purple is the AI/intelligence channel.
- Gray means the operator should not act from that data without more context.
- Every colored element must have a semantic reason and an accessible non-color cue.

## Token Direction

Keep the existing institutional dark base, but expand semantic tokens beyond P/L and grades.

| Token family | Role |
| --- | --- |
| `intel-bg`, `intel-panel`, `intel-panel2` | Workstation ground and raised surfaces |
| `intel-line`, `intel-lineSoft` | Structure, separators, table gridlines |
| `intel-ink`, `intel-ink2`, `intel-ink3` | Text hierarchy |
| `intel-pos` | Bullish, long, healthy, executed, filled, favorable |
| `intel-neg` | Bearish, short, rejected, stopped, failed, dangerous |
| `intel-warn` | Pending, caution, attention required |
| `intel-info` | Live stream, selected object, active data channel |
| `intel-ai` | AI recommendation, GPT analysis, intelligence overlay |
| `intel-muted` | Inactive, unavailable, historical |

If implementation lacks `intel-ai` or `intel-muted`, add tokens rather than overloading amber or gray.

## Component Inventory Additions

The original reusable primitives remain correct. Add workstation primitives that support scan-first behavior:

| Component | Purpose |
| --- | --- |
| `SemanticStatusBadge` | One consistent badge for live, snapshot, stale, pending, failed, rejected, filled, healthy |
| `DirectionBadge` | Bullish, bearish, neutral, long, short with icon and color |
| `ConfidenceMeter` | Compact confidence bar or radial indicator with label |
| `RiskMeter` | Low, medium, high, critical risk indicator |
| `QuoteFlash` | Restrained bid/ask/last update pulse for live price changes |
| `LivePulse` | Tiny animated dot for active streams and heartbeats |
| `AIRecommendationBadge` | Purple AI recommendation/AI watching marker |
| `InstrumentCard` | Cockpit-style card for active positions |
| `ScannerSignalCard` | Actionable scanner result card |
| `OptionMoneynessBand` | ITM/ATM/OTM/deep-moneyness visual encoding |
| `ActivityEventRow` | Trading-event first row with collapsed repetitive operational events |

## Watchlist Revision

The watchlist should behave like a market scanner, not a monochrome sidebar.

Each row must show:

- Symbol
- Price
- Daily percent direction
- Strength or signal intensity
- Sparkline
- Freshness: LIVE, SNAPSHOT, STALE, DISCONNECTED
- AI interest marker when applicable
- Position marker when applicable

Visual behavior:

- Bullish rows lean green through direction glyphs and edge accents.
- Bearish rows lean red through direction glyphs and edge accents.
- Live rows show a blue live pulse and age.
- AI watched rows show a purple AI badge.
- Selected row uses blue highlight, not amber.
- Stale rows desaturate to gray and show quote age.

Wireframe:

```text
| blue edge | NVDA      $191.42  up 2.81%   sparkline   LIVE 3s   AI |
| red edge  | TSLA      $312.08  down 1.12% sparkline   SNAP 28s  -  |
| green edge| AAPL      $214.77  up 0.44%   sparkline   LIVE 1s   POS|
```

## Option Chain Revision

The option chain should let an operator visually locate actionable contracts without reading every number.

Required visual encodings:

- Deep ITM, ITM, ATM, OTM, Deep OTM each have a distinct but restrained band treatment.
- Currently selected contract uses blue row selection.
- AI recommended contracts use purple outline or marker.
- Highest volume uses a volume heat marker.
- Highest open interest uses an OI marker.
- Unusual activity uses amber or purple depending on source: market anomaly amber, AI-detected intelligence purple.
- Illiquid contracts desaturate and lose action emphasis.

Wireframe:

```text
CALLS                         STRIKE                         PUTS
Vol  OI  Bid Ask  Delta       500      Delta  Bid Ask  OI  Vol
--   --  --  --   --        [DEEP ITM] --     --  --   --  --
18k  9k  6.10 6.25 .54   [ATM | selected | AI] .46 5.90 6.05 12k 21k
--   --  --  --   --        [DEEP OTM] --     --  --   --  --
```

## Position Card Revision

Active positions should look like cockpit instruments. They should not read as generic cards full of small gray stats.

Each position instrument must visually expose:

- Direction: long/short, bullish/bearish
- P/L and return percent
- Confidence
- Risk level
- Exit status
- Live bid
- Live ask
- Live spread
- Time held

Visual behavior:

- Direction is the left edge and primary badge.
- P/L is the largest numeric readout after symbol/contract.
- Risk is a meter, not only text.
- Exit status is a prominent state pill: Hold, Watch, Exit Near, Exit Triggered.
- Live quote fields flash subtly on update.
- Stale quote fields desaturate and show age.

Wireframe:

```text
| green edge | SPY 500C Jul24        LONG BULLISH        LIVE 1s
|            | +$128.00  +14.6%      Confidence 82       Risk MED
|            | Bid 6.10   Ask 6.25   Spread 2.4%         Held 18m
|            | Exit: Watch target    [Close Position]
```

## Automation Revision

Automation should feel alive without becoming decorative.

Show a compact instrument strip:

- Heartbeat
- Scheduler
- Next decision check
- Positions monitored
- Broker connection
- Market connection
- AI engine
- Risk engine

Each status gets:

- Icon
- Semantic color
- Short label
- Last update or next update time

Wireframe:

```text
Heartbeat LIVE 1s | Scheduler Active | Next Check 24s | Positions 3
Broker Connected  | Market Open      | AI Ready       | Risk Nominal
```

Detailed scheduler ticks, leases, queues, Mongo, cache, raw logs, and timeline remain in System Operations.

## Scanner Revision

Scanner results should be actionable cards or dense tiles, not passive tables.

Each scanner card should show:

- Symbol
- Direction
- Confidence
- Flow
- Trend
- Risk
- Expected move
- Strategy
- Recommendation

Visual behavior:

- Strong bullish candidates scan green.
- Strong bearish candidates scan red.
- AI-generated recommendations carry purple markers.
- Risk conflicts use amber or red overlays.
- Cards with no action remain gray and lower contrast.

Wireframe:

```text
NVDA  BULLISH       Confidence 88     Flow Strong
Trend Up            Risk Medium       Exp Move 3.2%
Strategy: Debit call spread
Recommendation: Watch 195C/200C, confirm spread < 8%
```

## Timeline Revision

The original audit is correct that timelines need grouping and progressive disclosure. The revision is about what remains visible.

Always visible:

- Signal found
- Risk approved
- Risk rejected
- Order submitted
- Order filled
- Position opened
- Position closed
- Exit triggered
- Emergency stop
- Broker disconnect
- Provider disconnect
- Reconciliation failure

Collapsed by default:

- Heartbeats
- Scheduler ticks
- Monitor checks
- Cache hits
- Repetitive polling events

Grouped rows should still preserve counts and time range:

```text
Monitor checks collapsed: 42 events, 10:30:00-10:51:00
```

## Motion

Motion is permitted only when it communicates a state change.

Allowed:

- Live quote pulse on bid/ask/last change
- Heartbeat pulse
- New signal slide/fade into scanner
- Position opened/closed flash
- AI thinking shimmer while waiting for analysis
- Warning escalation pulse for critical risk

Not allowed:

- Decorative animations
- Constant glowing panels
- Motion that implies live data when the source is snapshot-only
- Flashing without a state transition

## Accessibility

Scan-first does not mean color-only.

Every semantic color must have at least one companion cue:

- Icon
- Label
- Shape
- Border pattern
- Tooltip or accessible title
- `aria-label` for status and direction

Reduced motion must disable non-essential animation and preserve static state indicators.

## Progressive Disclosure

Preserve the original audit's progressive disclosure model:

- Trading: opportunity and action first, chain/detail second.
- Portfolio: capital and positions first, risk/allocation/orders second, system link last.
- Cockpit: active trade instrument first, exit/action second, reasoning/evidence third.
- Intelligence: command center and narrative first, evidence/timeline/raw data collapsed.
- System Operations: diagnostics first, raw logs/timeline available but grouped.

## Boundary Confirmation

This revision is visual and compositional only.

Do not change:

- Backend logic
- API contracts
- Mongo schemas
- Broker integration
- Risk engine
- Automation lifecycle
- GPT prompts
- Trading algorithms
- Evaluation engine

The goal is to make the same data more scannable, actionable, and institutionally legible.
