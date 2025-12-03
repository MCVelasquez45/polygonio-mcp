import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import analyzeRouter from './routes/analyze';
import chatRouter from './routes/chat';
import conversationsRouter from './routes/conversations';
import marketRouter from './routes/market';
import brokerRouter from './routes/broker';
import analysisRouter from './routes/analysis';
import { initMongo } from './services/mongo';
import { ensureMarketCacheIndexes } from './services/marketCache';
import { startAggregatesWorker } from './services/aggregatesWorker';

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

io.on('connection', socket => {
  console.log('[SERVER] WebSocket client connected:', socket.id);
  socket.emit('connected', { msg: 'WebSocket connected' });

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
