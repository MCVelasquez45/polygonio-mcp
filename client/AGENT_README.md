# Client Internal Documentation ("Agent Readme")

This document provides a deep dive into the client application architecture, intended for AI agents and developers who need to understand the system's inner workings beyond the surface-level instructions.

## 1. Project Overview

- **Type**: Single Page Application (SPA)
- **Framework**: React 18 + Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS (with `postcss` and `autoprefixer`)
- **Key Libraries**:
  - `lightweight-charts`: Financial charting.
  - `socket.io-client`: Real-time bi-directional communication with the server.
  - `lucide-react`: Iconography.
  - `axios`: HTTP client (implied).

The client acts as the dashboard for a trading/analysis platform, connecting to a Node.js/Python backend ecosystem.

## 2. Directory Structure (`client/src`)

```
src/
├── api/             # API entry points (REST wrappers)
│   ├── alpaca.ts    # Integration with Alpaca (brokerage)
│   ├── analysis.ts  # Analysis data fetching
│   ├── chat.ts      # LLM/Chat interface endpoints
│   ├── http.ts      # Base HTTP client configuration
│   ├── market.ts    # Market data endpoints (aggregates, quotes)
│   └── index.ts     # Exports
├── components/      # UI Components (Domain Driven)
│   ├── trading/     # Execution interfaces (OrderTicket, PositionList)
│   ├── options/     # Options chain and analysis
│   ├── screener/    # Market scanners
│   ├── portfolio/   # Portfolio visualization
│   ├── chat/        # AI Copilot logic
│   ├── layout/      # App scaffolding (Header, etc.)
│   └── shared/      # Reusable UI atoms
├── types/           # TS Interfaces & Shared Models
├── utils/           # Helper functions
├── App.tsx          # Main Application Orchestrator & State Hub
├── main.tsx         # React Entry Point
└── styles.css       # Global styles & Tailwind directives
```

## 3. Architecture & Data Flow

### The `App.tsx` Monolith
The `App.tsx` file serves as the central brain of the application. It is significantly large and handles:
- **Global State**: Manages `activeTicker`, `connectionStatus`, `messages` (chat), and more.
- **Data Orchestration**: Fetches initial data (market snapshots, watchlists) and handles polling/updates.
- **WebSocket Management**: Establishes the `socket.io` connection and routes incoming events to state updaters.
- **View Routing**: Manages the switch between "Trading Desk", "Scanner", "Portfolio", and "Checklists" via local state `currentView`.

**Pattern**: High-level state is "hoisted" to `App.tsx` and passed down via props to children in `components/`.

### Real-time Updates
Data flows from the server via `socket.io`.
- **Events**: The client listens for events like `T` (trade), `Q` (quote), or custom application events.
- **Throttling**: Components often use local refs or throttled state updates to prevent React render thrashing from high-frequency market data.

### Charting
Visualizations are powered by `lightweight-charts`.
- **Integration**: Typically wrapped in React `useEffect` hooks to manage the imperative chart API (create chart, add series, update data).
- **Data**: Charts consume generic `AggregateBar` arrays.

## 4. Key Subsystems

### Trading Desk
Located in `components/trading/`.
- **OrderTicket**: Form for submitting buy/sell orders.
- **ActiveTrade**: Real-time visualizations of open positions.

### Options Chain
Located in `components/options/`.
- Renders complex nested tables of calls/puts.
- Likely manages its own internal state for expansion/collapsing but relies on `App.tsx` for the underlying data source.

### AI Copilot (Chat)
Located in `components/chat/`.
- Interfaces with the backend AI service.
- State is managed in `App.tsx` (`messages`, `isAiTyping`) to persist conversation across view changes.

## 5. Development Guidelines

### Adding a New Feature
1.  **Define Types**: Update `src/types/` with new data models.
2.  **API Layer**: Add fetch functions in `src/api/`.
3.  **Component**: Create the UI in `src/components/<domain>/`.
4.  **Integration**:
    - Import the component in `App.tsx`.
    - Add necessary state/handlers in `App.tsx`.
    - Pass props down.

### Performance Considerations
- **Memoization**: `useMemo` and `useCallback` are heavy utilized in `App.tsx` to prevent unnecessary re-renders of heavy sub-trees (like charts).
- **Refs**: Mutable `useRef` is often used for high-frequency data (like last price) where a re-render isn't strictly necessary for every tick, or to bridge non-React libraries (charts).
