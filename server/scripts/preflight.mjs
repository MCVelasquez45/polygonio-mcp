// Automation launch preflight — READ ONLY. Never submits an order.
//
//   node scripts/preflight.mjs            # readiness check (submission off → warning)
//   node scripts/preflight.mjs --launch   # launch mode (submission MUST be enabled)
//
// Exits 0 only when launch-ready; nonzero with structured reasons otherwise.
// All secrets are redacted.
import 'dotenv/config';
import mongoose from 'mongoose';

const LAUNCH = process.argv.includes('--launch');
const checks = [];
const add = (name, status, detail, extra = {}) => checks.push({ name, status, detail, ...extra });

function resolveMongo() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/market-copilot';
  let dbName = 'market-copilot';
  try {
    const u = new URL(uri);
    if (u.pathname && u.pathname !== '/') dbName = u.pathname.replace(/^\/+/, '');
  } catch {}
  return { uri, dbName };
}

async function main() {
  const dist = (p) => import(`../dist/${p}`);
  const { uri, dbName } = resolveMongo();

  // 1. Config validation (fail closed on contradictory settings).
  const cfg = await dist('features/automation/automation.config.js');
  const validation = cfg.validateAutomationConfig();
  add('config', validation.ok ? 'pass' : 'fail', validation.ok ? 'valid' : validation.errors.join('; '), {
    resolved: validation.resolved,
    warnings: validation.warnings,
  });
  const signalMode = cfg.getSignalMode();
  add('signalMode', signalMode === 'OPTIONS_NATIVE_FLOW' ? 'pass' : 'fail', signalMode);
  const risk = cfg.getStrategyConfig().risk;
  add('singlePosition', risk.maxConcurrentPositions === 1 ? 'pass' : 'fail', `maxConcurrentPositions=${risk.maxConcurrentPositions}`);
  const exit = cfg.getExitPolicyConfig();
  add('riskConfig', exit.stopLossPct > 0 && exit.profitTargetPct > 0 ? 'pass' : 'fail',
    `stopLoss=${exit.stopLossPct} target=${exit.profitTargetPct} maxExitRetries=${exit.maxExitRetries} exitTimeoutMs=${exit.exitTimeoutMs}`);
  const submissionEnabled = cfg.getSubmissionEnabled();
  add('submission', submissionEnabled ? 'pass' : LAUNCH ? 'fail' : 'warn',
    `AUTOMATION_SUBMIT_APPROVED_INTENTS=${submissionEnabled}${LAUNCH && !submissionEnabled ? ' (launch mode requires enabled)' : ''}`);

  // 2. Alpaca endpoint must be the paper endpoint (never live money).
  const baseUrl = process.env.APCA_API_BASE_URL || process.env.ALPACA_BASE_URL || '';
  const isPaperUrl = /paper-api\.alpaca\.markets/.test(baseUrl);
  const isLiveUrl = /(^|\/\/)api\.alpaca\.markets/.test(baseUrl);
  add('alpacaPaperUrl', isPaperUrl && !isLiveUrl ? 'pass' : 'fail', isPaperUrl ? 'paper endpoint' : `NON-PAPER endpoint (${baseUrl ? 'set' : 'unset'})`);

  // 3. Mongo.
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    add('mongo', mongoose.connection.readyState === 1 ? 'pass' : 'fail', `connected db=${dbName}`);
  } catch (e) {
    add('mongo', 'fail', `connect failed: ${String(e?.message ?? e)}`);
  }

  // 4. Indexes + watchlist provider + at least one automation symbol.
  if (mongoose.connection.readyState === 1) {
    try {
      const recovery = await dist('features/automation/services/sessionRecovery.service.js');
      await recovery.ensureAutomationIndexes();
      add('mongoIndexes', 'pass', 'automation indexes ensured');
    } catch (e) {
      add('mongoIndexes', 'fail', String(e?.message ?? e));
    }
    try {
      const provider = await dist('features/watchlist/automationUniverseProvider.service.js');
      provider.resetAutomationUniverseProviderForTests?.();
      const universe = await provider.refreshAutomationUniverse(Date.now());
      add('watchlistProvider', 'pass', `source=${universe.source} cacheTtlMs=${provider.getAutomationUniverseRefreshTtlMs()}`);
      add('automationSymbols', universe.symbols.length > 0 ? 'pass' : 'fail',
        universe.symbols.length ? `enabled=[${universe.symbols.join(', ')}]` : 'NO automation-enabled symbols');
    } catch (e) {
      add('watchlistProvider', 'fail', String(e?.message ?? e));
    }
    // A READY session drives the evaluation loop (the scheduler runs READY sessions).
    try {
      const { AutomationSessionModel } = await dist('features/automation/models/automationSession.model.js');
      const readyCount = await AutomationSessionModel.countDocuments({ status: 'READY' });
      add('runnableSession', readyCount > 0 ? 'pass' : 'fail',
        readyCount > 0 ? `${readyCount} READY session(s)` : 'no READY session — run seed-launch-watchlist or activate one');
    } catch (e) {
      add('runnableSession', 'warn', String(e?.message ?? e));
    }
  }

  // 5. Broker + market data + reconciliation via the real init (read-only).
  let adapter = null;
  try {
    const recovery = await dist('features/automation/services/sessionRecovery.service.js');
    const init = await recovery.initializeAutomation({});
    const runtime = recovery.getAutomationRuntime();
    adapter = runtime.adapter ?? null;
    add('reconciliation', init.ready ? 'pass' : 'fail', `state=${init.state} ready=${init.ready}`);
    add('automationReady', recovery.isAutomationReady() ? 'pass' : (LAUNCH ? 'fail' : 'warn'), init.detail);
  } catch (e) {
    add('reconciliation', 'fail', String(e?.message ?? e));
  }

  if (adapter) {
    try {
      const account = await adapter.getAccount();
      add('alpacaAuth', 'pass', `account ${account.accountIdMasked} reachable (paper=${account.isPaper})`);
      add('alpacaPaperAccount', account.isPaper ? 'pass' : 'fail', `isPaper=${account.isPaper}`);
    } catch (e) {
      add('alpacaAuth', 'fail', String(e?.message ?? e));
    }
    try {
      const clock = await adapter.getClock();
      add('brokerClock', 'pass', `serverTime=${clock.timestamp ?? clock.serverTime ?? 'ok'} isOpen=${clock.isOpen ?? clock.is_open}`);
    } catch (e) {
      add('brokerClock', 'fail', String(e?.message ?? e));
    }
    // Unknown automation-owned broker state.
    try {
      const { AutomationPositionModel } = await dist('features/automation/models/automationPosition.model.js');
      const { OrderIntentModel } = await dist('features/automation/models/orderIntent.model.js');
      const manualReview = await AutomationPositionModel.countDocuments({ status: 'MANUAL_REVIEW' });
      const unresolved = await OrderIntentModel.countDocuments({ status: { $in: ['SUBMITTING', 'MANUAL_REVIEW'] } });
      add('noUnknownBrokerState', manualReview === 0 && unresolved === 0 ? 'pass' : 'fail',
        `manualReviewPositions=${manualReview} unresolvedIntents=${unresolved}`);
    } catch (e) {
      add('noUnknownBrokerState', 'warn', String(e?.message ?? e));
    }
  }

  // 6. Live Massive options entitlement + chain fetch — probe the FIRST
  //    watchlist automation symbol (no hardcoded ticker).
  try {
    const provider = await dist('features/watchlist/automationUniverseProvider.service.js');
    const universe = await provider.getAutomationUniverse(Date.now());
    const probe = universe.symbols[0];
    if (!probe) {
      add('massiveOptions', 'warn', 'no watchlist symbol to probe (empty universe)');
    } else {
      const md = await dist('features/automation/services/automationMarketData.service.js');
      const cfgMod = await dist('features/automation/automation.config.js');
      const chain = await md.fetchOptionChain(cfgMod.getStrategyConfig(probe), 'BULLISH', null, Date.now());
      const ok = chain && Array.isArray(chain.contracts);
      add('massiveOptions', ok ? 'pass' : 'fail',
        ok ? `${probe} chain fetched (contracts=${chain.contracts.length}, underlyingPrice=${chain.underlyingPrice})` : 'no chain');
    }
  } catch (e) {
    add('massiveOptions', 'fail', String(e?.message ?? e));
  }

  // 7. Scheduler + lease configuration.
  const sched = cfg.getSchedulerConfig();
  add('schedulerConfig', sched.enabled && sched.leaseTtlMs > sched.intervalMs ? 'pass' : 'fail',
    `enabled=${sched.enabled} intervalMs=${sched.intervalMs} leaseTtlMs=${sched.leaseTtlMs}`);

  // 8. Emergency stop state (no active session → inactive is expected).
  try {
    const { AutomationSessionModel } = await dist('features/automation/models/automationSession.model.js');
    const stopped = await AutomationSessionModel.countDocuments({ 'emergencyStop.active': true });
    add('emergencyStop', stopped === 0 ? 'pass' : (LAUNCH ? 'fail' : 'warn'), `activeEmergencyStops=${stopped}`);
  } catch (e) {
    add('emergencyStop', 'warn', String(e?.message ?? e));
  }

  await mongoose.disconnect().catch(() => {});

  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const summary = {
    ranAt: new Date().toISOString(),
    mode: LAUNCH ? 'launch' : 'readiness',
    ready: fails.length === 0,
    fails: fails.length,
    warns: warns.length,
    checks,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(fails.length === 0
    ? `\nPREFLIGHT: READY (${warns.length} warning(s))`
    : `\nPREFLIGHT: NOT READY — ${fails.length} failure(s): ${fails.map((f) => f.name).join(', ')}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: String(e?.message ?? e) }));
  process.exit(2);
});
