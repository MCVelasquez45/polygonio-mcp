import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
// Central application entrypoint wiring platform feature routers + shared middleware.
import { analyzeRouter } from './features/assistant';
import { chatRouter, conversationsRouter } from './features/conversations';
import { marketRouter } from './features/market';
import { brokerRouter } from './features/broker';
import { analysisRouter } from './features/analysis';
import { initMongo } from './shared/db/mongo';
import { ensureMarketCacheIndexes } from './features/market/services/marketCache';
import { startAggregatesWorker } from './features/market/services/aggregatesWorker';
import { initLiveFeed, registerLiveFeedHandlers } from './features/market/services/liveFeed';

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[SERVER] ${req.method} ${req.originalUrl} received`, req.body ?? {});
  next();
});

app.get('/health', (_req, res) => {
  console.log('[SERVER] GET /health responded with ok');
  res.json({ ok: true });
});

app.use('/api/analyze', analyzeRouter);
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/market', marketRouter);
app.use('/api/broker', brokerRouter);
app.use('/api/analysis', analysisRouter);

app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[SERVER] Unhandled error', { path: req.originalUrl, error });
  const status = error?.response?.status ?? error?.status ?? 500;
  const payload = error?.response?.data ?? { error: error?.message ?? 'Internal server error' };
  res.status(status).json(payload);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' }
});
initLiveFeed(io);

io.on('connection', socket => {
  console.log('[SERVER] WebSocket client connected:', socket.id);
  socket.emit('connected', { msg: 'WebSocket connected' });
  registerLiveFeedHandlers(socket);

  socket.on('disconnect', reason => {
    console.log('[SERVER] WebSocket client disconnected:', socket.id, reason);
  });
});

async function start() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/market-copilot';
  try {
    await initMongo(mongoUri);
    await ensureMarketCacheIndexes();
    startAggregatesWorker();
  } catch (error) {
    console.error('[SERVER] Failed to connect to MongoDB', error);
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log(`[SERVER] API listening on :${PORT}`);
  });
}

start().catch(error => {
  console.error('[SERVER] Uncaught bootstrap error', error);
  process.exit(1);
});

export { io };
