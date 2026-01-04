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
  const mongoConfig = resolveMongoConfig();
  try {
    logMongoGuidance(mongoConfig);
    await initMongo(mongoConfig.uri, mongoConfig.dbName);
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

type MongoConfig = {
  uri: string;
  dbName: string;
  connectionType: 'atlas' | 'local' | 'unknown';
  host: string | null;
  fromEnv: 'MONGO_URI' | 'MONGODB_URI' | 'default';
};

function resolveMongoConfig(): MongoConfig {
  const envUri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
  const fromEnv = process.env.MONGO_URI
    ? 'MONGO_URI'
    : process.env.MONGODB_URI
    ? 'MONGODB_URI'
    : 'default';
  const uri = envUri || 'mongodb://127.0.0.1:27017/market-copilot';
  if (!uri) {
    throw new Error('MONGO_URI is required to start the server.');
  }
  const parsed = parseMongoUri(uri);
  return {
    uri,
    dbName: parsed.dbName ?? 'market-copilot',
    connectionType: parsed.connectionType,
    host: parsed.host,
    fromEnv
  };
}

function parseMongoUri(uri: string): { dbName: string | null; connectionType: MongoConfig['connectionType']; host: string | null } {
  const connectionType = uri.startsWith('mongodb+srv://')
    ? 'atlas'
    : uri.startsWith('mongodb://')
    ? 'local'
    : 'unknown';
  let dbName: string | null = null;
  let host: string | null = null;
  try {
    const url = new URL(uri);
    host = url.host || null;
    if (url.pathname && url.pathname !== '/') {
      dbName = url.pathname.replace(/^\/+/, '') || null;
    }
  } catch {
    // Fall back to regex parsing for non-standard URI formats.
  }
  if (!dbName) {
    const pathMatch = uri.match(/\/([^/?]+)(?:\?|$)/);
    dbName = pathMatch?.[1] ?? null;
  }
  return { dbName, connectionType, host };
}

function logMongoGuidance(config: MongoConfig) {
  const typeLabel =
    config.connectionType === 'atlas'
      ? 'MongoDB Atlas detected (cloud-hosted database)'
      : config.connectionType === 'local'
      ? 'Local MongoDB detected'
      : 'MongoDB connection detected';
  console.log(`[SERVER] ${typeLabel}.`);
  if (config.host) {
    console.log(`[SERVER] Mongo host: ${config.host}`);
  }
  console.log(`[SERVER] Mongo database: ${config.dbName} (${config.fromEnv})`);
  if (config.connectionType === 'atlas') {
    console.log('[SERVER] Atlas is always running—no manual start required.');
    console.log('[SERVER] Tip: use mongosh with your Atlas connection string to inspect data.');
  } else {
    console.log('[SERVER] Tip: start mongod locally or point MONGO_URI to Atlas.');
  }
  console.log('[SERVER] AGG_WORKER_ENABLED controls background aggregate ingestion.');
}
