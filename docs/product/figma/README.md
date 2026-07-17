# AI-Trader / Polygon Market Copilot Product Handoff

Date: July 16, 2026

This folder preserves product-design context for the AI-Trader / Polygon Market Copilot milestone. No Figma export or prototype URL is currently stored in the repository. Add links here only when an actual project-owned Figma file, prototype, screenshot, or export is available.

## Main Workspaces

- Trading: chart-first trading workspace for contract discovery, order tickets, and manual market interaction.
- Scanner: market and options discovery workflow for candidate identification.
- Portfolio: portfolio management surface for open positions, balances, buying power, orders, historical positions, daily P/L, and allocation context.
- Cockpit: active-trade management workspace for one automation-owned options position.
- The Lab: strategy research, compilation, and experimentation workspace.
- Automation Command Center: operational control and health surface for autonomous trading sessions, watchlists, risk state, and recovery actions.
- Trading Intelligence: planned reporting and analytics layer for session capture, missed opportunity review, daily reporting, and advisory recommendations.

## Cockpit Design Principles

The cockpit is not a second portfolio dashboard. It answers the active-trade questions a trader needs within seconds:

- What trade am I in?
- What is it worth right now?
- What is my risk?
- Why is automation holding?
- What causes an exit?
- What is my exit order doing?
- Is market data healthy?
- If something is unavailable, why?

## Active-Trade Terminology

Use readable option labels as the primary identity when possible, for example:

`SOFI Jul 17 2026 $18 Call`

The raw OCC symbol may be shown as secondary metadata. Avoid using the OCC symbol as the main label when the readable label is available.

The Trade Header owns these active-trade values:

- Contract
- Direction
- Quantity
- Entry
- Current mark
- P/L
- Return
- Bid
- Ask
- Mid
- Spread

Secondary panels must not repeat those values as independent summaries.

## Quote Ownership

The cockpit has one quote source of truth:

`useCockpitQuote()` -> shared `useLiveQuote()` store -> shared socket updates -> active-trade snapshot fallback.

The Live Market panel receives the same quote object used by the Trade Header. It must not fetch a second quote, maintain duplicate quote state, or calculate conflicting bid/ask/mid/spread values.

If no quote is available, show one explanatory provider message instead of empty metric rows.

## Honest Empty-State Language

Do not display placeholder values such as `$0.00`, `N/A`, generic dashes, or neutral defaults when the backend did not provide the value.

Preferred language:

- `Not captured`
- `Unavailable from current provider`
- `No live quote is currently available from the provider.`
- `No market context snapshot was captured for this trade.`
- `No contract attribution is available for this position.`
- `This trade predates attribution capture.`

## Operator Controls

Operator actions remain accessible from the cockpit but must not dominate the trade view. Destructive actions require confirmation. Controls should use existing broker and automation endpoints and must not bypass broker reconciliation or execution boundaries.

Expected controls include:

- Cancel active exit order when broker state allows it.
- Flatten/close the active position with confirmation.
- Pause entries at the session level.
- Trigger emergency stop with confirmation.

## Automation Command Center

The Automation Command Center is the portfolio/operations control plane. It owns account-level automation status, watchlist controls, engine status, risk and recovery operations, and operational telemetry.

The cockpit owns only the active trade. Engineering telemetry such as scheduler, worker, lease, reconciliation, and internal socket details should stay out of the normal cockpit view unless a developer diagnostics mode is explicitly enabled.

## Current Product Limitations

- Paper-trading only for the verified milestone.
- Live quote availability depends on the provider socket and entitlement state.
- Volume, open interest, greeks, attribution, and market context render only when the backend or provider exposes them for the active contract.
- Some existing positions may predate attribution capture.
- Trading Intelligence and daily reporting are planned but not implemented in this milestone.

## Implementation Status

Implemented in the client cockpit components:

- `client/src/components/cockpit/CockpitLayout.tsx`
- `client/src/components/cockpit/CockpitWorkspace.tsx`
- `client/src/components/cockpit/CockpitCommandBar.tsx`
- `client/src/components/cockpit/LiveMarketPanel.tsx`
- `client/src/components/cockpit/PositionHealthPanel.tsx`
- `client/src/components/cockpit/ExitIntelligencePanel.tsx`
- `client/src/components/cockpit/BotThinkingPanel.tsx`
- `client/src/components/cockpit/ExecutionPanel.tsx`
- `client/src/components/cockpit/OperatorActions.tsx`
- `client/src/components/cockpit/MarketContextPanel.tsx`
- `client/src/components/cockpit/OpportunityPanel.tsx`
- `client/src/components/cockpit/cockpitQuote.ts`
- `client/src/components/cockpit/cockpitDisplay.ts`

Relevant regression coverage:

- `client/src/__tests__/cockpit.test.tsx`
- `client/src/__tests__/liveMarketPanel.test.tsx`
- `client/src/__tests__/opportunity.test.tsx`
- `client/src/__tests__/exitIntelligence.test.tsx`
- `client/src/__tests__/execution.test.tsx`
