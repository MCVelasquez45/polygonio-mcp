import 'dotenv/config';
import express from 'express';
import cors, { type CorsOptions } from 'cors';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { createProxyMiddleware } from 'http-proxy-middleware';
// Central application entrypoint wiring platform feature routers + shared middleware.
import { agentProxyRouter, analyzeRouter } from './features/assistant';
import { chatRouter, conversationsRouter } from './features/conversations';
import { marketRouter } from './features/market';
import { brokerRouter, manualTradingRouter } from './features/broker';
import { analysisRouter } from './features/analysis';
import { handoffRouter } from './features/handoff/handoff.routes';
import { labRouter } from './features/lab/lab.routes';
import { chartHealthRouter } from './features/market/chartHealth.routes';
import { engineRouter } from './features/engine/engine.routes';
import { futuresRouter, initFuturesRuntime, seedDefaultContractSpecs } from './features/futures';
import { strategyRouter } from './features/strategy/strategy.routes';
import { automationRouter } from './features/automation/automation.routes';
import { automationOpsRouter } from './features/automation/automationOps.routes';
import { watchlistRouter } from './features/watchlist';
import { systemHealthRouter } from './features/system/systemHealth.routes';
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from './features/automation/services/schedulerController.service';
import {
  startMonitorScheduler,
  stopMonitorScheduler,
} from './features/automation/services/monitorController.service';
import {
  startOrderReconciliationWorker,
  stopOrderReconciliationWorker,
} from './features/automation/services/orderReconciliation.service';
import { getAutomationRuntime } from './features/automation/services/sessionRecovery.service';
import { portfolioRouter } from './features/portfolio/portfolio.routes';
import {
  registerAutomationVisibilityHandlers,
  startAutomationVisibilityBroadcaster,
  stopAutomationVisibilityBroadcaster,
} from './features/portfolio/automationVisibilitySocket.service';
import { marketDataRouter } from './features/marketData/marketData.routes';
import {
  initializeOptionsStreamOwner,
  shutdownOptionsStream,
} from './features/marketData/optionsSubscriptionManager.service';
import { intelligenceRouter } from './features/intelligence/intelligence.routes';
import { optionsRouter } from './features/options/options.routes';
import { initializeAutomation } from './features/automation/services/sessionRecovery.service';
import { initMongo } from './shared/db/mongo';
import { serializeErrorForLog, writeStructuredLog } from './shared/logging/safeLogging';
import { ensureMarketCacheIndexes } from './features/market/services/marketCache';
import { startAggregatesWorker } from './features/market/services/aggregatesWorker';
import {
  initLiveFeed,
  registerLiveFeedHandlers,
  subscribeAggregateSymbol,
  unsubscribeAggregateSymbol
} from './features/market/services/liveFeed';
import { initChartHub, registerChartHubHandlers } from './features/market/services/chartHub';

const app = express();
const corsOrigin = buildCorsOrigin();
const corsOptions: CorsOptions = {
  origin: corsOrigin,
  credentials: false,
};
app.use(cors(corsOptions));

// Proxy: Python Screener Service
// Must be placed before bodyParser/express.json() to stream requests correctly
const SCREENER_URL = process.env.SCREENER_URL || 'http://localhost:8001';
app.use(
  ['/api/screen', '/api/scan', '/api/lab/backtest', '/api/lab/screener'],
  createProxyMiddleware({
    target: SCREENER_URL,
    changeOrigin: true,
  })
);

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

type RequestWithContext = express.Request & { requestId?: string };

app.use((req: RequestWithContext, res, next) => {
  const headerRequestId = req.header('x-request-id');
  const requestId = headerRequestId && headerRequestId.length <= 128 ? headerRequestId : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  writeStructuredLog({
    component: 'server',
    module: 'http',
    event: 'HTTP_REQUEST',
    severity: 'info',
    requestId,
    context: {
      method: req.method,
      path: req.originalUrl,
      queryParamNames: Object.keys(req.query ?? {}),
    },
  });
  next();
});

app.get(['/health', '/api/health'], (_req, res) => {
  writeStructuredLog({
    component: 'server',
    module: 'health',
    event: 'HEALTH_CHECK_OK',
    severity: 'debug',
  });
  res.json({ ok: true });
});

app.use('/api/analyze', analyzeRouter);
app.use('/api/agent', agentProxyRouter);
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/market', marketRouter);
app.use('/api/options', optionsRouter);
app.use('/api/broker', brokerRouter);
app.use('/api/trading/manual', manualTradingRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/handoff', handoffRouter);
app.use('/api/lab', labRouter);
app.use('/api/chart/health', chartHealthRouter);
app.use('/api/engine', engineRouter);
app.use('/api/lab/futures', futuresRouter);
app.use('/api/engine/futures', futuresRouter);
app.use('/api/strategy', strategyRouter);
app.use('/api/automation', automationRouter);
app.use('/api/automation', automationOpsRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/system', systemHealthRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/market-data', marketDataRouter);
app.use('/api/intelligence', intelligenceRouter);

app.use((error: any, req: RequestWithContext, res: express.Response, _next: express.NextFunction) => {
  writeStructuredLog({
    component: 'server',
    module: 'http',
    event: 'UNHANDLED_ERROR',
    severity: 'error',
    requestId: req.requestId,
    context: {
      path: req.originalUrl,
      error: serializeErrorForLog(error),
    },
  });
  const status = error?.response?.status ?? error?.status ?? 500;
  const payload = error?.response?.data ?? { error: error?.message ?? 'Internal server error' };
  res.status(status).json(payload);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: false,
  }
});
app.set('io', io);
initLiveFeed(io);
initializeOptionsStreamOwner();
initChartHub({ io, subscribeAggregates: subscribeAggregateSymbol, unsubscribeAggregates: unsubscribeAggregateSymbol });
initFuturesRuntime(io);
startAutomationVisibilityBroadcaster(io);

io.on('connection', socket => {
  writeStructuredLog({
    component: 'server',
    module: 'socket',
    event: 'SOCKET_CONNECTED',
    severity: 'info',
    context: { socketId: socket.id },
  });
  socket.emit('connected', { msg: 'WebSocket connected' });
  registerLiveFeedHandlers(socket);
  registerChartHubHandlers(socket);
  registerAutomationVisibilityHandlers(io, socket);

  socket.on('disconnect', reason => {
    writeStructuredLog({
      component: 'server',
      module: 'socket',
      event: 'SOCKET_DISCONNECTED',
      severity: 'info',
      context: { socketId: socket.id, reason },
    });
  });
});

async function start() {
  const mongoConfig = resolveMongoConfig();
  // Default to allowing server to start without Mongo so core functionality
  // (webhooks, socket.io, strategy extraction) is never blocked by DB issues.
  const allowMongoSkip = String(process.env.MONGO_OPTIONAL ?? 'true').toLowerCase() !== 'false';
  try {
    logMongoGuidance(mongoConfig);
    await initMongo(mongoConfig.uri, mongoConfig.dbName);
    await ensureMarketCacheIndexes();
    await seedDefaultContractSpecs();
    // Drop stale unique index on strategyversions that conflicts with Lab version creation.
    // The Pipeline StrategyVersionModel (PipelineVersion) previously created { strategyId, version }
    // unique on the shared collection; Lab versions don't have a 'version' field so inserts fail.
    try {
      const mongoose = (await import('mongoose')).default;
      const col = mongoose.connection.collection('strategyversions');
      const indexes = await col.indexes();
      const stale = indexes.find(
        (idx: any) => idx.key?.strategyId && idx.key?.version && idx.unique
      );
      if (stale) {
        await col.dropIndex(stale.name!);
        console.log(`[SERVER] Dropped stale index '${stale.name}' from strategyversions`);
      }
    } catch (indexErr: any) {
      // Collection may not exist yet — ignore
      if (indexErr?.codeName !== 'NamespaceNotFound') {
        console.warn('[SERVER] Could not clean strategyversions indexes:', indexErr?.message);
      }
    }
    startAggregatesWorker();
  } catch (error) {
    console.error('[SERVER] Failed to connect to MongoDB', error);
    if (!allowMongoSkip) {
      process.exit(1);
    }
    console.warn('[SERVER] Continuing without MongoDB. Some features will be disabled.');
  }

  httpServer.listen(PORT, () => {
    console.log(`[SERVER] API listening on :${PORT}`);
  });

  // Automation safety foundation (Phase 2A): fail-closed init AFTER the HTTP
  // server is up so a broker/Mongo problem never blocks unrelated features.
  // When Mongo is down this resolves to state UNAVAILABLE without throwing.
  //
  // The two schedulers start ONLY after init resolves ready — i.e. after
  // startup reconciliation succeeded (reconciliation before activation).
  //   • evaluation scheduler → entries (evaluate → approve → submit)
  //   • monitoring scheduler → everything after a fill (monitor, stop-loss,
  //     profit-target, cancel unfilled entries, reconcile EXITING, flatten EOD)
  // Both take independent single-owner DB leases; together they make the full
  // paper-trading lifecycle autonomous.
  initializeAutomation()
    .then(result => {
      if (result.ready) {
        // Keep broker truth current via the REST reconciliation worker (also the
        // fallback when a trade-update stream is unavailable).
        const adapter = getAutomationRuntime().adapter ?? undefined;
        if (adapter) startOrderReconciliationWorker(adapter);
        startAutomationScheduler();
        startMonitorScheduler();
      }
    })
    .catch(error => {
      console.error('[SERVER] Automation initialization failed (automation stays unavailable)', error);
    });
}

// Graceful shutdown: release the scheduler lease so a replacement instance can
// take ownership immediately instead of waiting for the lease to expire.
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] ${signal} received — stopping automation schedulers`);
  shutdownOptionsStream();
  stopAutomationVisibilityBroadcaster();
  stopOrderReconciliationWorker();
  await Promise.all([
    stopAutomationScheduler(signal).catch(() => undefined),
    stopMonitorScheduler(signal).catch(() => undefined),
  ]);
  process.exit(0);
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

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

type CorsOriginCallback = NonNullable<CorsOptions['origin']>;

function buildCorsOrigin(): CorsOriginCallback {
  const configuredOrigins = [
    ...splitOrigins(process.env.CORS_ORIGINS),
    ...splitOrigins(process.env.CLIENT_ORIGIN),
    ...splitOrigins(process.env.FRONTEND_ORIGIN),
    ...splitOrigins(process.env.VERCEL_FRONTEND_URL),
  ];
  const allowed = new Set(
    configuredOrigins.map(origin => origin.replace(/\/+$/, '')).filter(Boolean)
  );

  if (process.env.NODE_ENV !== 'production') {
    for (const origin of [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost:4000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:4000',
    ]) {
      allowed.add(origin);
    }
  }

  if (process.env.NODE_ENV === 'production' && allowed.size === 0) {
    writeStructuredLog({
      component: 'server',
      module: 'cors',
      event: 'CORS_ORIGINS_NOT_CONFIGURED',
      severity: 'warning',
      context: {
        message: 'Browser CORS requests will be rejected until CORS_ORIGINS or FRONTEND_ORIGIN is configured.',
      },
    });
  }

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/+$/, '');
    if (allowed.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}
