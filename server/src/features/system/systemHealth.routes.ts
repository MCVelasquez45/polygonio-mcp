import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { getMassiveRequestStats } from '../../shared/data/massive';
import {
  getSignalMode,
  getSubmissionEnabled,
  validateAutomationConfig,
} from '../automation/automation.config';
import { getSchedulerStatus } from '../automation/services/schedulerController.service';
import { getMonitorStatus } from '../automation/services/monitorController.service';
import { isAutomationReady, getAutomationRuntime } from '../automation/services/sessionRecovery.service';
import { isBrokerTruthCurrent } from '../automation/services/orderReconciliation.service';
import { buildMarketDataHealthReport } from '../marketData/optionsDataHealth.service';
import { getAutomationUniverse, getAutomationUniverseRefreshTtlMs } from '../watchlist/automationUniverseProvider.service';

// Sprint 2F — /api/system/health. A single composite health surface for every
// core component. Fast + read-only: it composes in-process signals and last-known
// broker/market-data truth (no fresh broker/Massive network calls), so it can be
// polled cheaply. Each component reports GREEN / YELLOW / RED.

type Level = 'GREEN' | 'YELLOW' | 'RED';
const RANK: Record<Level, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export const systemHealthRouter = Router();

systemHealthRouter.get('/health', async (_req: Request, res: Response) => {
  const now = Date.now();
  const components: Record<string, { status: Level; detail: string }> = {};
  const set = (name: string, status: Level, detail: string) => {
    components[name] = { status, detail };
  };

  // Mongo
  const mongoUp = mongoose.connection?.readyState === 1;
  set('mongo', mongoUp ? 'GREEN' : 'RED', mongoUp ? 'connected' : 'disconnected');

  // Config-derived
  const cfg = validateAutomationConfig();
  set('risk', cfg.ok ? 'GREEN' : 'RED', cfg.ok ? 'config valid' : cfg.errors.join('; '));
  set('automation', isAutomationReady() ? 'GREEN' : 'YELLOW', isAutomationReady() ? 'READY' : 'not ready');
  set('signalMode', getSignalMode() === 'OPTIONS_NATIVE_FLOW' ? 'GREEN' : 'YELLOW', getSignalMode());
  const submission = getSubmissionEnabled();
  set('submission', submission ? 'GREEN' : 'YELLOW', submission ? 'enabled' : 'evaluate-only (disabled)');

  // Schedulers + heartbeat freshness
  const sched = getSchedulerStatus();
  const mon = getMonitorStatus();
  set('scheduler', sched.state === 'ACTIVE' ? 'GREEN' : 'RED', `state=${sched.state}`);
  set('monitor', mon.state === 'ACTIVE' ? 'GREEN' : 'RED', `state=${mon.state}`);
  const hbAge = (ts: string | null) => (ts ? now - new Date(ts).getTime() : Infinity);
  const schedAge = hbAge(sched.lastTickAt);
  const monAge = hbAge(mon.lastTickAt);
  const hbLevel: Level = Math.max(schedAge, monAge) < 90_000 ? 'GREEN' : Math.min(schedAge, monAge) < 90_000 ? 'YELLOW' : 'RED';
  set('heartbeat', hbLevel, `evalTickAgeMs=${Number.isFinite(schedAge) ? schedAge : 'n/a'} monitorTickAgeMs=${Number.isFinite(monAge) ? monAge : 'n/a'}`);

  // Broker + execution (last-known truth; no fresh network call here)
  const adapter = getAutomationRuntime().adapter;
  set('broker', adapter ? 'GREEN' : 'YELLOW', adapter ? 'paper adapter resolved' : 'adapter not resolved');
  set('execution', 'GREEN', 'single execution gateway (broker adapter)');
  const truthCurrent = isBrokerTruthCurrent(now);
  set('alpaca', adapter ? (truthCurrent ? 'GREEN' : 'YELLOW') : 'YELLOW', `brokerTruthCurrent=${truthCurrent}`);

  // Massive market data + request manager
  try {
    const md = buildMarketDataHealthReport();
    const rest = (md as any)?.optionsRest?.status ?? 'UNKNOWN';
    set('massive', rest === 'OK' ? 'GREEN' : rest === 'UNKNOWN' ? 'YELLOW' : 'RED', `optionsRest=${rest}`);
  } catch (e: any) {
    set('massive', 'YELLOW', String(e?.message ?? e));
  }
  const q = getMassiveRequestStats();
  set('queue', q.queueDepth < 50 ? 'GREEN' : q.queueDepth < 200 ? 'YELLOW' : 'RED', `depth=${q.queueDepth} active=${q.activeRequests} inflightDeduped=${q.inflightDeduped}`);
  set('rateLimit', q.queueDepth < 200 ? 'GREEN' : 'YELLOW', `single shared request manager; queueDepth=${q.queueDepth}`);
  set('cache', 'GREEN', `single shared response cache (${q.responseCacheEntries} entries) + orchestrator chain/reference/quote caches`);

  // Watchlist universe + WebSocket
  if (mongoUp) {
    try {
      const universe = await getAutomationUniverse(now);
      set('watchlist', universe.empty ? 'YELLOW' : 'GREEN', universe.empty ? 'no automation symbols' : `symbols=[${universe.symbols.join(', ')}] ttlMs=${getAutomationUniverseRefreshTtlMs()}`);
    } catch (e: any) {
      set('watchlist', 'RED', String(e?.message ?? e));
    }
  } else {
    set('watchlist', 'RED', 'mongo down');
  }
  set('websocket', 'GREEN', 'shared live feed (single subscription manager per symbol)');

  const overall: Level = (Object.values(components).map((c) => c.status).reduce<Level>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'GREEN'));
  res.status(overall === 'RED' ? 503 : 200).json({
    status: overall,
    timestamp: new Date(now).toISOString(),
    components,
  });
});
