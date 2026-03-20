# Market Gateway (Server) Internal Documentation ("Agent Readme")

This document provides a deep dive into the server application architecture, intended for AI agents and developers who need to understand the backend's inner workings.

## 1. Project Overview

- **Type**: REST API + WebSocket Server
- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Key Libraries**:
  - `socket.io`: Real-time bi-directional communication (market data feeds).
  - `mongodb`: Persistence for user data, cache, and conversations.
  - `@alpacahq/alpaca-trade-api`: Brokerage execution integration.
  - `axios`: External HTTP requests (Polygon.io, etc.).

The server ("Market Gateway") acts as the bridge between the frontend (Client), the Broker (Alpaca), and Data Providers (Polygon.io, Massive). It aggregates data, executes trades, and powers the AI features.

## 2. Directory Structure (`server/src`)

The codebase uses a **Feature-Based Architecture**. Each domain (Market, Broker, Assistant) is containerized in `features/` with its own routes, services, and types.

```
src/
├── features/             # Feature domains
│   ├── market/           # Market Data (Quotes, Aggregates, Websockets)
│   │   ├── services/     # Business logic (LiveFeed, ChartHub, MarketCache)
│   │   └── market.routes.ts # REST endpoints for /api/market
│   ├── broker/           # Execution & Account Management (Alpaca)
│   ├── assistant/        # AI Analysis & Inference (RAG, Tools)
│   ├── conversations/    # Chat persistence & history
│   ├── analysis/         # Technical analysis computations
│   └── options/          # Options-specific logic
├── shared/               # Shared Utilities
│   ├── db/               # MongoDB connection (mongo.ts)
│   ├── ai/               # Shared AI utilities (audit.ts)
│   └── data/             # Common data transformation helpers
├── index.ts              # Entry Point (Express + Socket.io wiring)
└── types/                # (Optional) Global shared types
```

## 3. Architecture & Data Flow

### Entry Point (`index.ts`)
- Initializes **Express** app and **Socket.IOServer**.
- Connects to **MongoDB** (Atlas or Local).
- Mounts feature routers: `/api/market`, `/api/broker`, `/api/chat`.
- Starts background workers (e.g., `startAggregatesWorker`).

### Real-time Data (`features/market`)
The core value prop is live data.
- **LiveFeed Service**: Manages a connection to Polygon.io (or similar) WebSockets.
- **Broadcasting**: Incoming ticks (Trade `T`, Quote `Q`) are rebroadcast to connected clients via `socket.io`.
- **ChartHub**: Manages subscriptions for chart data. When a client subscribes to `SPY` bars, the server ensures the upstream feed is active and pipes updates.

### Cache & Persistence
- **Mongo**: Stores `User` (minimal), `Conversation` (chat history), and `MarketCache` (deduplicated bars/aggregates to save API calls).
- **AggregatesWorker**: A background process that likely syncs historical bars or fills gaps in the cache.

### Execution (`features/broker`)
Wraps the Alpaca API.
- **Orders**: Routes generic order objects to Alpaca.
- **Account**: Proxies account balances and positions.

### AI Layer (`features/assistant`)
- Handles "Chat with Market" requests.
- Likely uses an LLM (OpenAI/Anthropic) to interpret user queries ("Analyze SPY trend") and calls internal tools (Market API) to generate a response.

## 4. Key Configurations

- `.env`: Critical credentials (POLYGON_API_KEY, ALPACA_KEY, MONGO_URI, OPENAI_API_KEY).
- `MONGO_OPTIONAL=true`: Allows running the server with limited functionality if DB is down.

## 5. Development Guidelines

### Adding an API Endpoint
1.  Navigate to the relevant feature folder (e.g., `features/market`).
2.  Add the handler in `<feature>.routes.ts`.
3.  Implement business logic in `<feature>/services/`.

### Working with WebSockets
- Use `io.emit` or `socket.emit` in `features/market/services/liveFeed.ts` to push updates.
- Clients listen for specific event definitions (e.g., `T.${ticker}`).

### Debugging
- Logs are prefixed with `[SERVER]`.
- Use `npm run dev` for hot-reloading (via `ts-node-dev`).
