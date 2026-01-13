# Setup Instructions

Use this guide to get the project running from a clean machine. It covers prerequisites, environment variables, and the workflow for running both the server and client.

## 1. Prerequisites
- Node.js 20+
- npm 10+
- MongoDB instance (local or Atlas).  
- Massive.com API key with aggregates, quotes, and options scopes.  
- Optional: Alpaca paper trading credentials (for the portfolio panel).  
- Optional: FastAPI “brain” service for AI scanner + chat responses.

## 2. Install Dependencies
```bash
# root folder
npm install

cd server && npm install
cd ../client && npm install
```

## 3. Environment Variables
Create `.env` files in `server/` and `client/` (if needed). Minimum server vars:
```
PORT=4000
MONGO_URI=mongodb://localhost:27017/polygonio
MASSIVE_API_KEY=...
MASSIVE_BASE_URL=https://api.massive.com
FASTAPI_BASE_URL=http://localhost:8000 (optional)
AGG_WORKER_ENABLED=false
MASSIVE_OPTIONS_WS_URL=wss://socket.massive.com/options (optional)
MASSIVE_OPTIONS_WS_CHANNELS=T,Q (optional, trade + quote channels for live subscriptions)
MASSIVE_OPTIONS_WS_AGG_CHANNELS=AM,A (optional, AM streams 1m aggregates, A streams 1s aggregates)
MASSIVE_OPTIONS_WS_STORE_AGGS=true (optional, cache live AM bars to Mongo)
```
Alpaca (optional):
```
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
# legacy names also supported: ALPACA_KEY_ID / ALPACA_SECRET_KEY
ALPACA_BASE_URL=https://paper-api.alpaca.markets
```
FastAPI/chat integration (optional):
```
CHAT_BASE_URL=http://localhost:8001
```

## 4. Database Prep
Run MongoDB locally (`mongod`) or point `MONGO_URI` to your Atlas cluster. The server auto-creates collections (`aggregates`, `watchlistSnapshots`, etc.) on first write—no manual migrations needed.

## 5. Running Locally
```bash
# First terminal: backend
cd server
npm run dev

# Second terminal: client (Vite)
cd client
npm run dev
```
The client dev server defaults to `http://localhost:5173` and proxies API calls to `http://localhost:4000`.

## 6. Optional Services
- **FastAPI Brain**: start your FastAPI project and expose `/analysis/watchlist` + `/chat` equivalents. The Node server will call it when `FASTAPI_BASE_URL` is defined and AI features are enabled in Settings.
- **Aggregates Worker**: set `AGG_WORKER_ENABLED=true` if you want background caching. Leave it off during normal dev to avoid hitting Massive rate limits.

## 7. Testing / Linting
```bash
cd client && npm run build   # type-checks + bundles via Vite
cd server && npm run lint    # if ESLint is configured
```

## 8. Production Build
1. `cd client && npm run build` to output static assets.  
2. Deploy the server (Node 20 runtime) and serve the `client/dist` directory via your hosting stack (or front the Node server with a static host).  
3. Make sure env vars are set, including `MASSIVE_API_KEY` and `MONGO_URI`.  
4. Monitor Massive rate-limit headers; the live WebSocket feed can reduce 1m REST polling for option contracts when enabled.
