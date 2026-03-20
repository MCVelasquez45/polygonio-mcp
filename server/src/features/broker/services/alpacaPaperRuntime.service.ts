import type { Server as SocketServer } from 'socket.io';
import { AlpacaPaperSessionModel } from '../models/alpacaPaperSession.model';
import { LabStrategyModel } from '../../handoff/models/strategyModel';
import {
  getAlpacaAccount,
  getAlpacaLatestTrade,
  getAlpacaBarsV2,
  submitAlpacaEquityOrder,
  getAlpacaPosition,
  closeAlpacaPosition,
  listAlpacaPositions,
} from './alpaca';
import {
  evaluateRuleBasedSignal,
  hasMatchableRules,
  computeSMA,
  computeEMA,
  computeRSI,
  computeATR,
  type SignalContext,
  type StrategyRules,
} from '../../futures/services/signalEngine.service';
import type { FuturesBar } from '../../futures/services/databentoGateway.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StartAlpacaPaperInput = {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  symbol: string; // equity symbol (SPY, QQQ, AAPL, etc.)
  qty: number;
  initialCapital?: number;
  maxDailyLoss?: number;
  maxDrawdownPct?: number;
  intervalSeconds?: number;
};

type AlpacaRuntimeState = {
  sessionId: string;
  symbol: string;
  timer: NodeJS.Timeout;
  paused: boolean;
  strategyRules?: StrategyRules;
  barHistory: FuturesBar[];
  signalPosition: 1 | -1 | 0;
  signalEntryPrice: number;
  peakEquity: number;
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const runtimeSessions = new Map<string, AlpacaRuntimeState>();
let io: SocketServer | null = null;

export function initAlpacaPaperRuntime(socketServer: SocketServer) {
  io = socketServer;
}

// ---------------------------------------------------------------------------
// Fetch warmup bars from Alpaca market data
// ---------------------------------------------------------------------------

async function fetchWarmupBars(symbol: string): Promise<FuturesBar[]> {
  try {
    const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const rawBars = await getAlpacaBarsV2(symbol, { start, timeframe: '1Day', limit: 50 });
    return rawBars.map(b => ({
      timestamp: b.Timestamp,
      open: b.OpenPrice,
      high: b.HighPrice,
      low: b.LowPrice,
      close: b.ClosePrice,
      volume: b.Volume,
    }));
  } catch (err: any) {
    console.warn(`[ALPACA-PAPER] Failed to fetch warmup bars for ${symbol}:`, err?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Core evaluation loop
// ---------------------------------------------------------------------------

function createAlpacaTimer(runtime: AlpacaRuntimeState, intervalMs: number) {
  const lookback = 10;

  return setInterval(async () => {
    if (runtime.paused) return;

    const session = await AlpacaPaperSessionModel.findById(runtime.sessionId);
    if (!session || session.status !== 'running') return;

    const rules = runtime.strategyRules;
    if (!rules) return;

    try {
      // 1. Fetch latest price from Alpaca
      const latestTrade = await getAlpacaLatestTrade(runtime.symbol);
      const price = latestTrade?.Price ?? (latestTrade as any)?.p ?? 0;
      if (!price || price <= 0) return;

      const now = new Date();

      // 2. Build a synthetic bar from the latest trade
      const bar: FuturesBar = {
        timestamp: now.toISOString(),
        open: session.state.lastPrice || price,
        high: Math.max(session.state.lastPrice || price, price),
        low: Math.min(session.state.lastPrice || price, price),
        close: price,
        volume: 0,
      };

      runtime.barHistory.push(bar);
      if (runtime.barHistory.length > 100) {
        runtime.barHistory = runtime.barHistory.slice(-100);
      }

      const history = runtime.barHistory;

      // 3. Build signal context
      const ctx: SignalContext = {
        bar,
        barIndex: history.length - 1,
        history: history.slice(-lookback),
        position: runtime.signalPosition,
        entryPrice: runtime.signalEntryPrice,
        sma: computeSMA(history, lookback),
        ema: computeEMA(history, lookback),
        rsi: computeRSI(history, 14),
        atr: computeATR(history, 14),
        dailyPnl: session.state.dailyPnl,
        totalPnl: session.state.realizedPnl + session.state.unrealizedPnl,
        equity: session.state.equity,
        peakEquity: runtime.peakEquity,
        initialCapital: session.config.initialCapital,
      };

      // 4. Evaluate strategy signal
      const engineSignal = evaluateRuleBasedSignal(rules, ctx);
      let targetPosition = runtime.signalPosition;
      let signalReason = '';

      if (engineSignal) {
        targetPosition = engineSignal.action;
        signalReason = engineSignal.reason;
      } else if (history.length > lookback) {
        // Fallback: SMA crossover
        if (bar.close > ctx.sma * 1.0025) targetPosition = 1;
        else if (bar.close < ctx.sma * 0.9975) targetPosition = -1;
        signalReason = 'SMA fallback';
      }

      // 5. Update session state with latest price
      session.state.lastPrice = price;
      session.state.lastUpdatedAt = now.toISOString();
      session.state.lastSignal = targetPosition === 1 ? 'LONG' : targetPosition === -1 ? 'SHORT' : 'FLAT';
      session.state.lastSignalReason = signalReason;

      // 6. Execute trade if signal changed
      if (targetPosition !== runtime.signalPosition) {
        const qty = session.config.qty;

        // Close existing position
        if (runtime.signalPosition !== 0) {
          try {
            const closeOrder = await closeAlpacaPosition(runtime.symbol);
            const closeOrderId = closeOrder?.id ?? closeOrder?.order_id ?? 'unknown';

            const grossPnl = (price - runtime.signalEntryPrice) * runtime.signalPosition * session.state.positionQty;
            session.state.realizedPnl += grossPnl;
            session.state.unrealizedPnl = 0;

            session.orders.push({
              alpacaOrderId: closeOrderId,
              symbol: runtime.symbol,
              side: runtime.signalPosition === 1 ? 'sell' : 'buy',
              qty: session.state.positionQty,
              type: 'market',
              status: 'submitted',
              filledPrice: price,
              filledAt: now.toISOString(),
              reason: signalReason || 'signal exit',
              createdAt: now.toISOString(),
            } as any);

            session.events.push({
              type: 'position_closed',
              timestamp: now.toISOString(),
              payload: {
                side: runtime.signalPosition === 1 ? 'sell' : 'buy',
                qty: session.state.positionQty,
                price,
                pnl: grossPnl,
                reason: signalReason,
                alpacaOrderId: closeOrderId,
              },
            } as any);

            io?.emit('alpaca:paper:order', {
              sessionId: runtime.sessionId,
              type: 'close',
              side: runtime.signalPosition === 1 ? 'sell' : 'buy',
              qty: session.state.positionQty,
              price,
              pnl: grossPnl,
              reason: signalReason,
            });

            console.log(`[ALPACA-PAPER] Closed ${runtime.symbol} position, PnL: $${grossPnl.toFixed(2)}`);
          } catch (closeErr: any) {
            console.warn(`[ALPACA-PAPER] Failed to close position:`, closeErr?.message);
            session.events.push({
              type: 'error',
              timestamp: now.toISOString(),
              payload: { action: 'close_position', error: closeErr?.message },
            } as any);
          }
        }

        // Open new position
        if (targetPosition !== 0) {
          const side = targetPosition === 1 ? 'buy' : 'sell';
          try {
            const order = await submitAlpacaEquityOrder({
              symbol: runtime.symbol,
              qty,
              side,
              type: 'market',
              time_in_force: 'day',
            });
            const orderId = order?.id ?? order?.order_id ?? 'unknown';

            runtime.signalEntryPrice = price;
            session.state.positionSide = targetPosition === 1 ? 'long' : 'short';
            session.state.positionQty = qty;
            session.state.positionAvgEntry = price;

            session.orders.push({
              alpacaOrderId: orderId,
              symbol: runtime.symbol,
              side,
              qty,
              type: 'market',
              status: 'submitted',
              filledPrice: price,
              filledAt: now.toISOString(),
              reason: signalReason || 'signal entry',
              createdAt: now.toISOString(),
            } as any);

            session.events.push({
              type: 'position_opened',
              timestamp: now.toISOString(),
              payload: {
                side,
                qty,
                price,
                reason: signalReason,
                alpacaOrderId: orderId,
              },
            } as any);

            io?.emit('alpaca:paper:order', {
              sessionId: runtime.sessionId,
              type: 'open',
              side,
              qty,
              price,
              reason: signalReason,
            });

            console.log(`[ALPACA-PAPER] Opened ${side} ${qty} ${runtime.symbol} @ ${price}`);
          } catch (orderErr: any) {
            console.warn(`[ALPACA-PAPER] Failed to submit order:`, orderErr?.message);
            session.events.push({
              type: 'error',
              timestamp: now.toISOString(),
              payload: { action: 'open_position', error: orderErr?.message },
            } as any);
          }
        } else {
          session.state.positionSide = 'flat';
          session.state.positionQty = 0;
          session.state.positionAvgEntry = 0;
        }

        runtime.signalPosition = targetPosition;
      }

      // 7. Sync account state from Alpaca
      try {
        const account = await getAlpacaAccount();
        const equity = Number(account?.equity ?? session.config.initialCapital);
        const cash = Number(account?.cash ?? session.config.initialCapital);
        session.state.equity = equity;
        session.state.cash = cash;

        // Calculate unrealized PnL from position
        if (runtime.signalPosition !== 0 && runtime.signalEntryPrice > 0) {
          session.state.unrealizedPnl =
            (price - runtime.signalEntryPrice) * runtime.signalPosition * session.state.positionQty;
        }

        session.state.dailyPnl = session.state.realizedPnl + session.state.unrealizedPnl;

        if (equity > runtime.peakEquity) {
          runtime.peakEquity = equity;
        }

        // Risk utilization
        session.state.riskUtilizationPct =
          session.config.maxDailyLoss > 0
            ? Math.min(100, (Math.abs(Math.min(0, session.state.dailyPnl)) / session.config.maxDailyLoss) * 100)
            : 0;

        // Auto-pause on max daily loss
        if (session.state.riskUtilizationPct >= 100) {
          session.status = 'paused';
          runtime.paused = true;
          session.events.push({
            type: 'risk_breach',
            timestamp: now.toISOString(),
            payload: { reason: 'max daily loss breached', dailyPnl: session.state.dailyPnl },
          } as any);

          io?.emit('alpaca:paper:risk', {
            sessionId: runtime.sessionId,
            status: 'paused',
            reason: 'max daily loss breached',
          });
        }
      } catch (acctErr: any) {
        console.warn(`[ALPACA-PAPER] Failed to sync account:`, acctErr?.message);
      }

      // 8. Trim events to prevent unbounded growth
      if (session.orders.length > 500) {
        session.orders = session.orders.slice(-500) as any;
      }
      if (session.events.length > 300) {
        session.events = session.events.slice(-300) as any;
      }

      await session.save();

      // 9. Broadcast state update
      io?.emit('alpaca:paper:update', {
        sessionId: runtime.sessionId,
        symbol: runtime.symbol,
        state: session.state,
        status: session.status,
      });
    } catch (err: any) {
      console.error(`[ALPACA-PAPER] Tick error for ${runtime.symbol}:`, err?.message);
    }
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startAlpacaPaperSession(input: StartAlpacaPaperInput) {
  const symbol = input.symbol.toUpperCase();
  const intervalSeconds = input.intervalSeconds ?? 60;
  const initialCapital = input.initialCapital ?? 100000;

  // Load strategy rules
  let strategyRules: StrategyRules | undefined;
  try {
    const strategy = await LabStrategyModel.findById(input.strategyId).lean();
    if (strategy) {
      const sc = (strategy as any).screenerConfig;
      const params = sc?.params ?? {};
      const entryRules = Array.isArray(params.entry_rules) ? params.entry_rules : [];
      const exitRules = Array.isArray(params.exit_rules) ? params.exit_rules : [];
      const riskManagement = Array.isArray(params.risk_management) ? params.risk_management : [];
      const { entry_rules, exit_rules, risk_management, source, hypothesis, transcript, parameter_definitions, ...rest } = params;
      strategyRules = { entry_rules: entryRules, exit_rules: exitRules, risk_management: riskManagement, parameters: rest };
    }
  } catch (err) {
    console.warn('[ALPACA-PAPER] Could not load strategy rules:', (err as any)?.message);
  }

  // Fetch warmup bars for indicator seeding
  const warmupBars = await fetchWarmupBars(symbol);

  // Get initial price
  let initialPrice = 0;
  try {
    const trade = await getAlpacaLatestTrade(symbol);
    initialPrice = trade?.Price ?? (trade as any)?.p ?? 0;
  } catch {
    if (warmupBars.length > 0) {
      initialPrice = warmupBars[warmupBars.length - 1].close;
    }
  }

  // Get account state from Alpaca
  let equity = initialCapital;
  let cash = initialCapital;
  try {
    const account = await getAlpacaAccount();
    equity = Number(account?.equity ?? initialCapital);
    cash = Number(account?.cash ?? initialCapital);
  } catch {
    console.warn('[ALPACA-PAPER] Could not fetch account, using defaults');
  }

  const now = new Date();
  const session = await AlpacaPaperSessionModel.create({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    backtestId: input.backtestId || undefined,
    versionLabel: input.versionLabel || undefined,
    symbol,
    status: 'running',
    config: {
      qty: input.qty,
      initialCapital,
      maxDailyLoss: input.maxDailyLoss ?? 5000,
      maxDrawdownPct: input.maxDrawdownPct ?? 0.08,
      intervalSeconds,
    },
    state: {
      lastPrice: initialPrice,
      equity,
      cash,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      positionSide: 'flat',
      positionQty: 0,
      positionAvgEntry: 0,
      riskUtilizationPct: 0,
      lastSignal: '',
      lastSignalReason: '',
      lastUpdatedAt: now.toISOString(),
    },
    orders: [],
    events: [
      {
        type: 'session_started',
        timestamp: now.toISOString(),
        payload: {
          symbol,
          qty: input.qty,
          initialPrice,
          warmupBars: warmupBars.length,
          hasRules: !!strategyRules && hasMatchableRules(strategyRules),
          intervalSeconds,
        },
      },
    ],
    startedAt: now,
  });

  const sessionId = String(session._id);
  const runtimeState: AlpacaRuntimeState = {
    sessionId,
    symbol,
    paused: false,
    timer: null as any,
    strategyRules,
    barHistory: warmupBars,
    signalPosition: 0,
    signalEntryPrice: 0,
    peakEquity: equity,
  };

  runtimeState.timer = createAlpacaTimer(runtimeState, intervalSeconds * 1000);
  runtimeSessions.set(sessionId, runtimeState);

  console.log(`[ALPACA-PAPER] Started session ${sessionId} for ${symbol} (${warmupBars.length} warmup bars, ${intervalSeconds}s interval)`);

  io?.emit('alpaca:paper:started', {
    sessionId,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    symbol,
  });

  return session.toObject();
}

export async function getAlpacaPaperSession(sessionId: string) {
  return AlpacaPaperSessionModel.findById(sessionId).lean();
}

export async function listAlpacaPaperSessions(strategyId?: string) {
  const filter = strategyId ? { strategyId } : {};
  return AlpacaPaperSessionModel.find(filter).sort({ createdAt: -1 }).limit(20).lean();
}

export async function controlAlpacaPaperSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'stop',
) {
  const session = await AlpacaPaperSessionModel.findById(sessionId);
  if (!session) throw new Error('Alpaca paper session not found');

  const runtime = runtimeSessions.get(sessionId);

  if (action === 'pause') {
    session.status = 'paused';
    if (runtime) runtime.paused = true;
  }

  if (action === 'resume') {
    session.status = 'running';
    if (runtime) runtime.paused = false;
  }

  if (action === 'stop') {
    session.status = 'stopped';
    session.endedAt = new Date();

    if (runtime) {
      clearInterval(runtime.timer);
      runtimeSessions.delete(sessionId);
    }

    // Close any open Alpaca position for this symbol
    try {
      await closeAlpacaPosition(session.symbol);
      session.events.push({
        type: 'position_closed_on_stop',
        timestamp: new Date().toISOString(),
        payload: { symbol: session.symbol },
      } as any);
    } catch {
      // Position may already be flat
    }
  }

  session.events.push({
    type: action === 'pause' ? 'session_paused' : action === 'resume' ? 'session_resumed' : 'session_stopped',
    timestamp: new Date().toISOString(),
    payload: { action },
  } as any);

  await session.save();

  io?.emit('alpaca:paper:update', {
    sessionId,
    symbol: session.symbol,
    state: session.state,
    status: session.status,
  });

  return session.toObject();
}
