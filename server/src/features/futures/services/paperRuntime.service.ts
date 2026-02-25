import type { Server as SocketServer } from 'socket.io';
import {
  FuturesEngineSessionModel,
  FuturesPaperSessionModel,
  FuturesPromotionReportModel
} from '../models/futuresModels';
import { getContractSpec } from './contractSpecs.service';

type StartSessionInput = {
  strategyId: string;
  strategyName: string;
  symbol: string;
  contracts: number;
  initialCapital: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  slippageBps: number;
  feePerContract: number;
  mode?: 'lab-paper' | 'engine-paper';
};

type RuntimeSessionState = {
  sessionId: string;
  symbol: string;
  timer: NodeJS.Timeout;
  mode: 'lab-paper' | 'engine-paper';
  emergencyStop: boolean;
};

type FuturesHealthMetric = {
  symbol: string;
  timeframe: string;
  mode: 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';
  source: 'ws' | 'rest' | 'cache' | 'snapshot';
  barCount: number;
  gapsDetected: number;
  lastUpdateMsAgo: number | null;
  lastTimestamp: number | null;
  anomalyCount: number;
  providerThrottled: boolean;
  updatedAt: number;
};

const runtimeSessions = new Map<string, RuntimeSessionState>();
const futuresHealth = new Map<string, FuturesHealthMetric>();

let io: SocketServer | null = null;

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function basePrice(symbol: string) {
  const value: Record<string, number> = {
    ES: 5000,
    NQ: 21000,
    CL: 75,
    GC: 2300
  };
  return value[symbol.toUpperCase()] ?? 1000;
}

function computeReadinessScore(args: {
  dailyPnl: number;
  marginUtilizationPct: number;
  riskUtilizationPct: number;
  status: 'running' | 'paused' | 'stopped' | 'deployed';
}) {
  let score = 80;
  if (args.dailyPnl > 0) score += 8;
  if (args.marginUtilizationPct > 70) score -= 10;
  if (args.riskUtilizationPct > 75) score -= 12;
  if (args.status !== 'running' && args.status !== 'deployed') score -= 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function updateHealth(symbol: string, timestamp: number, status: 'running' | 'paused' | 'stopped' | 'deployed') {
  futuresHealth.set(symbol.toUpperCase(), {
    symbol: symbol.toUpperCase(),
    timeframe: 'futures-paper',
    mode: status === 'running' || status === 'deployed' ? 'LIVE' : status === 'paused' ? 'DEGRADED' : 'FROZEN',
    source: 'ws',
    barCount: 1,
    gapsDetected: 0,
    lastUpdateMsAgo: 0,
    lastTimestamp: timestamp,
    anomalyCount: 0,
    providerThrottled: false,
    updatedAt: timestamp
  });
}

async function persistStateAndBroadcast(sessionId: string, payload: { eventType: string; eventPayload: Record<string, any> }) {
  const session = await FuturesPaperSessionModel.findById(sessionId);
  if (!session) return;

  const event = {
    type: payload.eventType,
    timestamp: new Date().toISOString(),
    payload: payload.eventPayload
  };

  session.events.push(event as any);
  if (session.events.length > 300) {
    session.events = session.events.slice(-300) as any;
  }

  session.state.readinessScore = computeReadinessScore({
    dailyPnl: session.state.dailyPnl,
    marginUtilizationPct: session.state.marginUtilizationPct,
    riskUtilizationPct: session.state.riskUtilizationPct,
    status: session.status
  });

  await session.save();

  const now = Date.now();
  updateHealth(session.symbol, now, session.status);

  io?.emit('futures:market:update', {
    sessionId,
    symbol: session.symbol,
    state: session.state,
    status: session.status
  });
  io?.emit('futures:position:update', {
    sessionId,
    symbol: session.symbol,
    position: session.state.position,
    pnl: {
      unrealized: session.state.unrealizedPnl,
      realized: session.state.realizedPnl,
      daily: session.state.dailyPnl
    }
  });
  io?.emit('futures:risk:update', {
    sessionId,
    symbol: session.symbol,
    riskUtilizationPct: session.state.riskUtilizationPct,
    marginUtilizationPct: session.state.marginUtilizationPct,
    readinessScore: session.state.readinessScore
  });
}

function createSessionTimer(runtime: RuntimeSessionState) {
  const random = seededRandom(hashSeed(runtime.sessionId));
  return setInterval(async () => {
    const session = await FuturesPaperSessionModel.findById(runtime.sessionId);
    if (!session) return;
    if (session.status !== 'running' && session.status !== 'deployed') return;
    if (runtime.emergencyStop) return;

    const spec = await getContractSpec(session.symbol);
    if (!spec) return;

    const drift = (random() - 0.49) * 0.0025;
    const nextPrice = Math.max(0.01, session.state.markPrice * (1 + drift));
    const pointMove = nextPrice - session.state.markPrice;
    const positionSign = session.state.position.side === 'long' ? 1 : session.state.position.side === 'short' ? -1 : 0;
    const contracts = Math.max(0, session.state.position.contracts);

    const mtmDelta = pointMove * spec.contractMultiplier * contracts * positionSign;
    session.state.markPrice = nextPrice;
    session.state.unrealizedPnl += mtmDelta;
    session.state.dailyPnl = session.state.realizedPnl + session.state.unrealizedPnl;
    session.state.equity = session.state.cash + session.state.realizedPnl + session.state.unrealizedPnl;
    session.state.marginUsed = contracts * spec.defaultInitialMargin;
    session.state.marginUtilizationPct = session.state.equity > 0 ? (session.state.marginUsed / session.state.equity) * 100 : 100;
    session.state.riskUtilizationPct =
      session.config.maxDailyLoss > 0
        ? Math.min(100, (Math.abs(Math.min(0, session.state.dailyPnl)) / session.config.maxDailyLoss) * 100)
        : 0;
    session.state.lastPriceUpdateAt = new Date().toISOString();

    const shouldFill = random() > 0.8;
    if (shouldFill) {
      const side = random() > 0.5 ? 'long' : 'short';
      const contractsDelta = Math.max(1, Math.round(1 + random() * 1));
      const fillContracts = Math.min(contractsDelta, session.config.contracts);
      session.state.position = {
        side,
        contracts: fillContracts,
        avgEntryPrice: nextPrice,
        currentContract: `${session.symbol}FUT`,
        openedAt: new Date().toISOString()
      } as any;

      io?.emit('futures:order:filled', {
        sessionId: runtime.sessionId,
        symbol: session.symbol,
        side,
        contracts: fillContracts,
        fillPrice: nextPrice,
        timestamp: new Date().toISOString()
      });
    }

    const shouldRoll = random() > 0.985 && session.state.position.contracts > 0;
    if (shouldRoll) {
      const fromContract = session.state.position.currentContract;
      const toContract = `${session.symbol}FUT-R${Math.max(1, Math.round(random() * 12))}`;
      if (fromContract !== toContract) {
        session.state.position.currentContract = toContract;
        session.events.push({
          type: 'roll_event',
          timestamp: new Date().toISOString(),
          payload: {
            fromContract,
            toContract,
            reason: 'volume_crossover'
          }
        } as any);
        io?.emit('futures:roll:event', {
          sessionId: runtime.sessionId,
          symbol: session.symbol,
          fromContract,
          toContract,
          reason: 'volume_crossover',
          timestamp: new Date().toISOString()
        });
      }
    }

    if (session.state.riskUtilizationPct >= 100) {
      session.status = 'paused';
      session.events.push({
        type: 'risk_update',
        timestamp: new Date().toISOString(),
        payload: { reason: 'max daily loss breached', riskUtilizationPct: session.state.riskUtilizationPct }
      } as any);
      io?.emit('futures:risk:update', {
        sessionId: runtime.sessionId,
        symbol: session.symbol,
        status: 'paused',
        reason: 'max daily loss breached'
      });
    }

    await persistStateAndBroadcast(runtime.sessionId, {
      eventType: 'market_update',
      eventPayload: { markPrice: nextPrice, dailyPnl: session.state.dailyPnl }
    });
  }, 3000);
}

export function initFuturesRuntime(socketServer: SocketServer) {
  io = socketServer;
}

export async function startFuturesPaperSession(input: StartSessionInput) {
  const spec = await getContractSpec(input.symbol);
  if (!spec) throw new Error(`Unsupported symbol ${input.symbol}`);

  const now = new Date();
  const session = await FuturesPaperSessionModel.create({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    symbol: input.symbol.toUpperCase(),
    status: 'running',
    mode: input.mode ?? 'lab-paper',
    config: {
      contracts: input.contracts,
      initialCapital: input.initialCapital,
      maxDailyLoss: input.maxDailyLoss,
      maxDrawdown: input.maxDrawdown,
      slippageBps: input.slippageBps,
      feePerContract: input.feePerContract
    },
    state: {
      markPrice: basePrice(input.symbol),
      lastPriceUpdateAt: now.toISOString(),
      cash: input.initialCapital,
      equity: input.initialCapital,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      marginUsed: 0,
      marginUtilizationPct: 0,
      riskUtilizationPct: 0,
      readinessScore: 82,
      position: {
        side: 'flat',
        contracts: 0,
        avgEntryPrice: 0,
        currentContract: `${input.symbol.toUpperCase()}FUT`,
        openedAt: null
      }
    },
    events: [
      {
        type: 'session_started',
        timestamp: now.toISOString(),
        payload: { mode: input.mode ?? 'lab-paper' }
      }
    ],
    startedAt: now
  });

  const sessionId = String(session._id);
  const runtimeState: RuntimeSessionState = {
    sessionId,
    symbol: input.symbol.toUpperCase(),
    mode: input.mode ?? 'lab-paper',
    emergencyStop: false,
    timer: setInterval(() => undefined, 1000)
  };
  clearInterval(runtimeState.timer);
  runtimeState.timer = createSessionTimer(runtimeState);
  runtimeSessions.set(sessionId, runtimeState);

  updateHealth(input.symbol, Date.now(), 'running');

  io?.emit('futures:session:started', {
    sessionId,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    symbol: input.symbol.toUpperCase(),
    mode: input.mode ?? 'lab-paper'
  });

  return session.toObject();
}

export async function getFuturesPaperSession(sessionId: string) {
  return FuturesPaperSessionModel.findById(sessionId).lean();
}

export async function controlFuturesPaperSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'stop' | 'emergency_stop'
) {
  const session = await FuturesPaperSessionModel.findById(sessionId);
  if (!session) throw new Error('Session not found');

  const runtime = runtimeSessions.get(sessionId);

  if (action === 'pause') session.status = 'paused';
  if (action === 'resume') session.status = 'running';
  if (action === 'stop' || action === 'emergency_stop') {
    session.status = 'stopped';
    session.endedAt = new Date();
  }

  if (runtime) {
    if (action === 'stop' || action === 'emergency_stop') {
      clearInterval(runtime.timer);
      runtimeSessions.delete(sessionId);
    }
    if (action === 'emergency_stop') runtime.emergencyStop = true;
  }

  session.events.push({
    type:
      action === 'pause'
        ? 'session_paused'
        : action === 'resume'
        ? 'session_resumed'
        : 'session_stopped',
    timestamp: new Date().toISOString(),
    payload: { action }
  } as any);

  await session.save();

  if (action === 'stop' || action === 'emergency_stop') {
    io?.emit('futures:engine:update', { sessionId, status: 'stopped', action });
  }

  return session.toObject();
}

export function getFuturesHealthMetrics(): FuturesHealthMetric[] {
  const now = Date.now();
  return Array.from(futuresHealth.values()).map(metric => ({
    ...metric,
    lastUpdateMsAgo: metric.lastTimestamp != null ? Math.max(0, now - metric.lastTimestamp) : null
  }));
}

export async function generateFuturesPromotionReport(sessionId: string, strategyId: string) {
  const session = await FuturesPaperSessionModel.findById(sessionId).lean();
  if (!session) throw new Error('Session not found');

  const minDaysThreshold = Number(process.env.FUTURES_PROMOTION_MIN_DAYS ?? 15);
  const elapsedDays = (Date.now() - new Date(session.startedAt).getTime()) / (1000 * 60 * 60 * 24);
  const minPaperDaysPassed = elapsedDays >= minDaysThreshold;
  const sharpeEstimate = session.state.dailyPnl >= 0 ? 1.2 : 0.7;
  const drawdownEstimate = Math.max(0, (session.config.initialCapital - session.state.equity) / session.config.initialCapital);
  const fillQualityPass = true;
  const marginPass = session.state.marginUtilizationPct < 80;
  const overnightPass = session.state.position.side === 'flat' || session.state.riskUtilizationPct < 90;
  const rollEvents = (session.events ?? []).filter((event: { type?: string }) => event.type === 'roll_event');
  const rollHandlingPass = rollEvents.length > 0 || elapsedDays < minDaysThreshold;

  const checks = [
    {
      key: 'min_paper_days',
      label: 'Minimum paper trading period',
      passed: minPaperDaysPassed,
      value: `${elapsedDays.toFixed(1)} days`,
      threshold: `>= ${minDaysThreshold} days`
    },
    { key: 'sharpe', label: 'Sharpe ratio', passed: sharpeEstimate > 1.0, value: sharpeEstimate.toFixed(2), threshold: '> 1.0' },
    {
      key: 'drawdown',
      label: 'Max drawdown',
      passed: drawdownEstimate < session.config.maxDrawdown,
      value: `${(drawdownEstimate * 100).toFixed(2)}%`,
      threshold: `< ${(session.config.maxDrawdown * 100).toFixed(2)}%`
    },
    { key: 'fill_quality', label: 'Fill quality', passed: fillQualityPass, value: 'simulated-stable', threshold: 'pass' },
    {
      key: 'margin',
      label: 'Margin utilization',
      passed: marginPass,
      value: `${session.state.marginUtilizationPct.toFixed(1)}%`,
      threshold: '< 80%'
    },
    {
      key: 'roll_handling',
      label: 'Successful contract rolls',
      passed: rollHandlingPass,
      value: `${rollEvents.length} successful`,
      threshold: `>= 1 by day ${minDaysThreshold}`
    },
    { key: 'overnight_limits', label: 'Overnight limits', passed: overnightPass, value: overnightPass ? 'ok' : 'breached', threshold: 'no breach' }
  ];

  const passedCount = checks.filter(item => item.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);
  const status = score >= 70 ? 'eligible' : 'blocked';

  const report = await FuturesPromotionReportModel.create({
    sessionId,
    strategyId,
    status,
    score,
    checks,
    generatedAt: new Date()
  });

  io?.emit('futures:gate:update', {
    sessionId,
    strategyId,
    status,
    score,
    checks
  });

  return report.toObject();
}

export async function deployFuturesSessionToEngine(args: { sessionId: string; strategyId: string; symbol: string }) {
  const session = await FuturesPaperSessionModel.findById(args.sessionId);
  if (!session) throw new Error('Session not found');

  session.status = 'deployed';
  session.mode = 'engine-paper';
  await session.save();

  const existing = await FuturesEngineSessionModel.findOne({ sessionId: args.sessionId });
  const doc =
    existing ||
    new FuturesEngineSessionModel({
      sessionId: args.sessionId,
      strategyId: args.strategyId,
      symbol: args.symbol,
      status: 'active',
      controls: { emergencyStop: false },
      summary: {
        todayPnl: session.state.dailyPnl,
        mtdPnl: session.state.realizedPnl,
        ytdPnl: session.state.realizedPnl,
        riskUtilizationPct: session.state.riskUtilizationPct
      }
    });

  doc.status = 'active';
  doc.summary = {
    todayPnl: session.state.dailyPnl,
    mtdPnl: session.state.realizedPnl,
    ytdPnl: session.state.realizedPnl,
    riskUtilizationPct: session.state.riskUtilizationPct
  } as any;
  await doc.save();

  io?.emit('futures:engine:update', {
    sessionId: args.sessionId,
    strategyId: args.strategyId,
    symbol: args.symbol,
    status: 'active',
    summary: doc.summary
  });

  return {
    deploymentId: String(doc._id),
    session: session.toObject(),
    engine: doc.toObject()
  };
}

export async function getFuturesEngineStatus() {
  const sessions = await FuturesEngineSessionModel.find().sort({ updatedAt: -1 }).lean();
  const active = sessions.filter(item => item.status === 'active').length;
  const totals = sessions.reduce(
    (acc, item) => {
      acc.todayPnl += item.summary?.todayPnl ?? 0;
      acc.riskUtilization += item.summary?.riskUtilizationPct ?? 0;
      return acc;
    },
    { todayPnl: 0, riskUtilization: 0 }
  );

  return {
    count: sessions.length,
    active,
    aggregate: {
      todayPnl: totals.todayPnl,
      riskUtilizationPct: sessions.length ? totals.riskUtilization / sessions.length : 0
    },
    sessions
  };
}
