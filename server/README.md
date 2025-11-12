# Express TypeScript Gateway

## Start
```bash
cd server
npm run dev
```

## API Routes

* `/api/analyze` → proxies to Python MCP `/analyze`
* `/api/chat` → proxies to Python MCP `/chat`

## Logging

All requests are logged to console:

* `[SERVER]` request start
* `[SERVER]` response received
* `[SERVER]` error caught
* `[SERVER]` WebSocket handshake and disconnect events
