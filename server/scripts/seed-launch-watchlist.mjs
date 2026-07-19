// Seed a conservative launch watchlist (idempotent). READ/WRITE watchlist only —
// never touches the broker. Usage:
//   DOTENV_CONFIG_PATH=./.env node scripts/seed-launch-watchlist.mjs [SYMBOL ...]
// Defaults to a single liquid symbol (SPY) with automation enabled.
import 'dotenv/config';
import mongoose from 'mongoose';

// Sprint 2F — NO hardcoded/demo default. The operator must pass explicit
// symbols; the watchlist only ever contains symbols intentionally added.
const targets = process.argv.slice(2).map((s) => s.toUpperCase());
if (targets.length === 0) {
  console.error('usage: node scripts/seed-launch-watchlist.mjs <SYMBOL> [SYMBOL ...]');
  console.error('  (no default symbol — pass the liquid symbol(s) you intend to trade)');
  process.exit(2);
}

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/market-copilot';
await mongoose.connect(uri, { dbName: 'market-copilot', serverSelectionTimeoutMS: 8000 });
const { ensureAutomationIndexes } = await import('../dist/features/automation/services/sessionRecovery.service.js');
await ensureAutomationIndexes();
const svc = await import('../dist/features/watchlist/watchlist.service.js');

for (const symbol of targets) {
  const item = await svc.upsertWatchlistItem({
    symbol,
    enabled: true,
    automationEnabled: true,
    priority: 10,
    strategy: 'OPTIONS_NATIVE_FLOW',
    minConfidence: 0.5,
    maxPositionSize: 1,
    maxSpreadPercent: 10,
    minDTE: 7,
    maxDTE: 21,
    notes: 'Conservative launch watchlist — single liquid symbol',
  });
  console.log(`seeded ${item.symbol}: automationEnabled=${item.automationEnabled} priority=${item.priority} maxPositionSize=${item.maxPositionSize}`);
}
const all = await svc.listWatchlist();
console.log('watchlist:', all.map((i) => `${i.symbol}(auto=${i.automationEnabled},p=${i.priority})`).join(', '));

// Ensure a READY automation session exists so the evaluation scheduler runs the
// watchlist (a session is CREATED on insert; activation promotes it to READY).
const automationSvc = await import('../dist/features/automation/automation.service.js');
const sessions = await automationSvc.listSessions(200);
let ready = sessions.find((s) => s.status === 'READY');
if (!ready) {
  const created = await automationSvc.createSession({
    strategyVersionId: process.env.AUTOMATION_STRATEGY_VERSION_ID || 'watchlist-automation-v1',
    underlying: null,
    universe: [], // watchlist is authoritative; session.universe is unused under OPTIONS_NATIVE_FLOW
  });
  ready = await automationSvc.activateSession(String(created._id));
  console.log(`session activated: ${ready._id} status=${ready.status} reconciliation=${ready.reconciliationStatus}`);
} else {
  console.log(`session already READY: ${ready._id} reconciliation=${ready.reconciliationStatus}`);
}
await mongoose.disconnect();
