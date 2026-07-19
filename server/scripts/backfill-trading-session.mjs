// Explicit one-time Trading Intelligence backfill.
//
// Usage:
//   npm run build
//   node scripts/backfill-trading-session.mjs 2026-07-16
//
// This script reads persisted V1 automation evidence and writes the V2
// intelligence session record. It never calls the broker and never changes
// automation execution state.
import 'dotenv/config';
import mongoose from 'mongoose';

const tradingDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate ?? '')) {
  console.error('usage: node scripts/backfill-trading-session.mjs YYYY-MM-DD');
  process.exit(2);
}

function resolveMongo() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/market-copilot';
  let dbName = 'market-copilot';
  try {
    const url = new URL(uri);
    if (url.pathname && url.pathname !== '/') dbName = url.pathname.replace(/^\/+/, '');
  } catch {}
  return { uri, dbName };
}

const { uri, dbName } = resolveMongo();
await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });

try {
  const { TradingSessionModel } = await import('../dist/features/intelligence/models/tradingSession.model.js');
  await TradingSessionModel.syncIndexes();
  const { backfillTradingSession } = await import(
    '../dist/features/intelligence/services/tradingSessionCapture.service.js'
  );
  const result = await backfillTradingSession(tradingDate);
  const session = result.session;
  console.log(
    JSON.stringify(
      {
        tradingDate: session.tradingDate,
        sessionId: session.sessionId,
        status: session.status,
        finalized: result.finalized,
        realizedPnl: session.tradeSummary.realizedPnl,
        tradesOpened: session.tradeSummary.tradesOpened,
        tradesClosed: session.tradeSummary.tradesClosed,
        warnings: session.warnings.map((item) => item.code),
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect().catch(() => undefined);
}
