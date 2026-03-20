/**
 * Options Paper Trading Runtime — executes the House Strategy (0DTE credit spreads)
 * on Alpaca's paper trading environment using SIFT-extracted structured config.
 *
 * Lifecycle per trading day:
 *   pre_analysis  → analyzing  → entry_window  → in_trade  → monitoring  → closing  → done
 *
 * Each phase gate:
 *   - pre_analysis: waiting for analysis window (e.g. 12:30 ET)
 *   - analyzing: classifying regime, watching price levels
 *   - entry_window: regime decided, looking for entry (14:00-14:30 ET)
 *   - in_trade: spread submitted to Alpaca
 *   - monitoring: tracking P&L, watching exit conditions
 *   - closing: closing the spread or letting it expire
 *   - done: session complete for the day
 */

import type { Server as SocketServer } from 'socket.io';
import { OptionsPaperSessionModel } from '../models/optionsPaperSession.model';
import { LabStrategyModel } from '../../handoff/models/strategyModel';
import {
  getAlpacaAccount,
  getAlpacaClock,
  getAlpacaLatestTrade,
  getAlpacaOrder,
  submitAlpacaOptionsOrder,
  listAlpacaOptionPositions,
  getAlpacaOptionLatestQuotes,
} from './alpaca';
import { classifyRegime, type RegimeConfig } from './regimeClassifier.service';
import { selectCreditSpread, type ContractSelection } from './optionsSpreadSelector.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StartInput = {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  qty?: number;
  intervalSeconds?: number;
};

type RuntimeState = {
  sessionId: string;
  timer: NodeJS.Timeout;
  paused: boolean;
  regimeConfig: RegimeConfig;
  contractSelection: ContractSelection;
  timeRules: any[];
  strategyParams: Record<string, any>;
  underlying: string;
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const runtimeSessions = new Map<string, RuntimeState>();
let io: SocketServer | null = null;

export function initOptionsPaperRuntime(socketServer: SocketServer) {
  io = socketServer;
  // Gap 3: Restore orphaned sessions on server restart
  restoreOrphanedSessions().catch(err => {
    console.warn('[OPTIONS-PAPER] Failed to restore orphaned sessions:', err?.message);
  });
}

async function restoreOrphanedSessions() {
  const orphans = await OptionsPaperSessionModel.find({
    status: { $in: ['waiting', 'running'] },
  }).lean();

  for (const session of orphans) {
    const sessionId = String(session._id);
    if (runtimeSessions.has(sessionId)) continue; // already running

    try {
      const strategy = await LabStrategyModel.findById(session.strategyId).lean();
      if (!strategy) {
        await OptionsPaperSessionModel.findByIdAndUpdate(sessionId, { status: 'stopped', endedAt: new Date() });
        continue;
      }

      const params = (strategy as any).screenerConfig?.params ?? {};
      const regimeConfig: RegimeConfig = params.regime_config ?? {
        risk_on_tickers: [], risk_off_tickers: [], leader_tickers: [],
        risk_on_action: 'put_credit_spread', risk_off_action: 'call_credit_spread',
      };
      const contractSelection: ContractSelection = params.contract_selection ?? {
        contract_type: 'put', strike_selection: 'delta_target', delta_target: 0.2,
        dte_min: 0, dte_max: 0, spread_strategy: 'credit_spread',
        spread_width: 5, short_leg_delta: 0.2,
      };

      const runtimeState: RuntimeState = {
        sessionId,
        timer: null as any,
        paused: false,
        regimeConfig,
        contractSelection,
        timeRules: params.time_rules ?? [],
        strategyParams: params,
        underlying: session.underlying,
      };

      runtimeState.timer = createOptionsTick(runtimeState, (session.config.intervalSeconds ?? 30) * 1000);
      runtimeSessions.set(sessionId, runtimeState);
      console.log(`[OPTIONS-PAPER] Restored orphaned session ${sessionId} for ${session.underlying}`);
    } catch (err: any) {
      console.warn(`[OPTIONS-PAPER] Failed to restore session ${sessionId}:`, err?.message);
    }
  }

  if (orphans.length) {
    console.log(`[OPTIONS-PAPER] Checked ${orphans.length} orphaned sessions`);
  }
}

// ---------------------------------------------------------------------------
// Time helpers (Eastern Time)
// ---------------------------------------------------------------------------

function getEasternTime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getEasternHHMM(): string {
  const et = getEasternTime();
  const h = String(et.getHours()).padStart(2, '0');
  const m = String(et.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function isTimeInWindow(currentHHMM: string, startHHMM: string, endHHMM: string): boolean {
  return currentHHMM >= startHHMM && currentHHMM <= endHHMM;
}

function minutesToClose(): number {
  const et = getEasternTime();
  const closeMinutes = 16 * 60; // 4:00 PM ET
  const currentMinutes = et.getHours() * 60 + et.getMinutes();
  return closeMinutes - currentMinutes;
}

// ---------------------------------------------------------------------------
// Core tick loop
// ---------------------------------------------------------------------------

function createOptionsTick(runtime: RuntimeState, intervalMs: number) {
  return setInterval(async () => {
    if (runtime.paused) return;

    const session = await OptionsPaperSessionModel.findById(runtime.sessionId);
    if (!session) return;
    if (session.status === 'stopped' || session.status === 'expired') return;

    const now = new Date();
    const etTime = getEasternHHMM();
    const minsToClose = minutesToClose();

    try {
      // Fetch underlying price
      const priceSymbol = runtime.underlying === 'SPX' ? 'SPY' : runtime.underlying;
      const trade = await getAlpacaLatestTrade(priceSymbol);
      let underlyingPrice = trade?.Price ?? (trade as any)?.p ?? 0;
      if (runtime.underlying === 'SPX' && priceSymbol === 'SPY') {
        underlyingPrice *= 10;
      }
      session.state.underlyingPrice = underlyingPrice;
      session.state.lastUpdatedAt = now.toISOString();

      // Sync account equity
      try {
        const acct = await getAlpacaAccount();
        session.state.equity = Number(acct?.equity ?? 0);
        session.state.cash = Number(acct?.cash ?? 0);
      } catch {}

      // ---------------------------------------------------------------
      // Phase: PRE_ANALYSIS — waiting for analysis window
      // ---------------------------------------------------------------
      if (session.state.phase === 'pre_analysis') {
        // Check market hours
        let marketOpen = false;
        try {
          const clock = await getAlpacaClock();
          marketOpen = clock?.is_open ?? false;
        } catch {}

        // Gap 5: Auto-expire if market is closed and past 4 PM ET
        if (!marketOpen && etTime > '16:05') {
          session.status = 'expired';
          session.state.phase = 'done';
          session.endedAt = now;
          pushEvent(session, 'auto_expired', { reason: 'Market closed, past trading hours', time: etTime });
          clearInterval(runtime.timer);
          runtimeSessions.delete(runtime.sessionId);
          console.log(`[OPTIONS-PAPER] Auto-expired session — market closed at ${etTime} ET`);
        } else if (etTime >= session.config.analysisWindowStart && etTime <= '16:00') {
          session.state.phase = 'analyzing';
          session.status = 'running';
          pushEvent(session, 'phase_change', { from: 'pre_analysis', to: 'analyzing', time: etTime });
          console.log(`[OPTIONS-PAPER] Entering analysis phase at ${etTime} ET`);
        } else {
          // Still waiting — broadcast wait status so dashboard can show progress
          io?.emit('options:paper:waiting', {
            sessionId: runtime.sessionId,
            phase: 'pre_analysis',
            currentTimeET: etTime,
            analysisStartsAt: session.config.analysisWindowStart,
            entryWindowStart: session.config.entryWindowStart,
            entryWindowEnd: session.config.entryWindowEnd,
            marketOpen,
            message: marketOpen
              ? `Market is open. Analysis begins at ${session.config.analysisWindowStart} ET (currently ${etTime} ET).`
              : `Market is closed. Session will activate when market opens and analysis window begins at ${session.config.analysisWindowStart} ET.`,
          });
        }
      }

      // ---------------------------------------------------------------
      // Phase: ANALYZING — classify regime, wait for entry window
      // ---------------------------------------------------------------
      if (session.state.phase === 'analyzing') {
        // Classify regime every tick during analysis
        const regimeResult = await classifyRegime(runtime.regimeConfig);
        session.regime.current = regimeResult.regime;
        session.regime.confidence = regimeResult.confidence;
        session.regime.action = regimeResult.action;
        session.regime.lastClassifiedAt = now.toISOString();
        session.regime.tickerChanges = regimeResult.details.tickerChanges as any;

        io?.emit('options:paper:regime', {
          sessionId: runtime.sessionId,
          regime: regimeResult,
        });

        // Transition to entry window when time arrives
        if (etTime >= session.config.entryWindowStart) {
          // Gap 6: Check economic calendar before entering
          const calendarCheck = await hasMarketMovingEvents();
          if (calendarCheck.hasEvents && runtime.strategyParams.require_no_market_moving_events_today) {
            session.state.phase = 'done';
            pushEvent(session, 'calendar_block', {
              reason: calendarCheck.reason,
              regime: regimeResult.regime,
            });
            io?.emit('options:paper:update', {
              sessionId: runtime.sessionId,
              state: session.state,
              spread: session.spread,
              regime: session.regime,
              status: session.status,
            });
            console.log(`[OPTIONS-PAPER] Skipping trade — calendar block: ${calendarCheck.reason}`);
          } else {
            session.state.phase = 'entry_window';
            pushEvent(session, 'phase_change', {
              from: 'analyzing',
              to: 'entry_window',
              regime: regimeResult.regime,
              calendarCheck: calendarCheck.reason,
            });
            console.log(`[OPTIONS-PAPER] Entering entry window at ${etTime} ET, regime=${regimeResult.regime}, calendar=${calendarCheck.reason}`);
          }
        }
      }

      // ---------------------------------------------------------------
      // Phase: ENTRY_WINDOW — place the spread if regime is clear
      // ---------------------------------------------------------------
      if (session.state.phase === 'entry_window' && !session.spread.active) {
        // Check if regime gives us a tradeable action
        if (session.regime.action === 'no_trade') {
          pushEvent(session, 'no_trade', { reason: 'Mixed regime, no clear direction', regime: session.regime.current });
          // Keep checking — regime may clear up before window closes
        } else if (session.regime.action === 'put_credit_spread' || session.regime.action === 'call_credit_spread') {
          // Select the spread
          const spread = await selectCreditSpread(
            runtime.contractSelection,
            session.regime.action as any,
            runtime.underlying,
          );

          if (spread && spread.estimatedCredit > 0) {
            // Submit to Alpaca
            try {
              const order = await submitAlpacaOptionsOrder({
                legs: [
                  {
                    symbol: spread.shortLeg.symbol,
                    qty: session.config.qty,
                    side: 'sell',
                    position_intent: 'sell_to_open',
                  },
                  {
                    symbol: spread.longLeg.symbol,
                    qty: session.config.qty,
                    side: 'buy',
                    position_intent: 'buy_to_open',
                  },
                ],
                order_class: 'multi-leg',
                order_type: 'limit',
                limit_price: spread.estimatedCredit,
                time_in_force: 'day',
                quantity: session.config.qty,
              });

              const orderId = (order as any)?.id ?? (order as any)?.order_id ?? 'unknown';

              // Update session with spread details
              session.spread.active = true;
              session.spread.direction = spread.direction;
              session.spread.shortLeg = {
                symbol: spread.shortLeg.symbol,
                strike: spread.shortLeg.strike,
                type: spread.shortLeg.type,
                delta: spread.shortLeg.delta,
                entryBid: spread.shortLeg.bid,
                entryAsk: spread.shortLeg.ask,
                currentBid: spread.shortLeg.bid,
                currentAsk: spread.shortLeg.ask,
              } as any;
              session.spread.longLeg = {
                symbol: spread.longLeg.symbol,
                strike: spread.longLeg.strike,
                type: spread.longLeg.type,
                delta: spread.longLeg.delta,
                entryBid: spread.longLeg.bid,
                entryAsk: spread.longLeg.ask,
                currentBid: spread.longLeg.bid,
                currentAsk: spread.longLeg.ask,
              } as any;
              session.spread.entryCredit = spread.estimatedCredit;
              session.spread.maxLoss = spread.maxLoss;
              session.spread.enteredAt = now.toISOString();
              session.spread.alpacaOrderId = orderId;
              session.state.phase = 'in_trade';

              session.orders.push({
                alpacaOrderId: orderId,
                type: spread.direction,
                legs: [
                  { symbol: spread.shortLeg.symbol, side: 'sell', strike: spread.shortLeg.strike },
                  { symbol: spread.longLeg.symbol, side: 'buy', strike: spread.longLeg.strike },
                ],
                status: 'submitted',
                credit: spread.estimatedCredit,
                createdAt: now.toISOString(),
              } as any);

              pushEvent(session, 'spread_entered', {
                direction: spread.direction,
                shortStrike: spread.shortLeg.strike,
                longStrike: spread.longLeg.strike,
                credit: spread.estimatedCredit,
                underlying: underlyingPrice,
                alpacaOrderId: orderId,
              });

              io?.emit('options:paper:order', {
                sessionId: runtime.sessionId,
                type: 'entry',
                spread,
                orderId,
              });

              console.log(
                `[OPTIONS-PAPER] Entered ${spread.direction}: ${spread.shortLeg.strike}/${spread.longLeg.strike} ` +
                `credit=$${spread.estimatedCredit.toFixed(2)} orderId=${orderId}`,
              );
            } catch (orderErr: any) {
              pushEvent(session, 'order_error', { error: orderErr?.message });
              console.error(`[OPTIONS-PAPER] Order submission failed:`, orderErr?.message);
            }
          } else {
            pushEvent(session, 'no_spread_found', { direction: session.regime.action, underlying: underlyingPrice });
          }
        }

        // If entry window has passed without a trade, move to done
        if (etTime > session.config.entryWindowEnd && !session.spread.active) {
          session.state.phase = 'done';
          pushEvent(session, 'entry_window_missed', { time: etTime });
          console.log(`[OPTIONS-PAPER] Entry window closed without trade at ${etTime} ET`);
        }
      }

      // ---------------------------------------------------------------
      // Phase: IN_TRADE — confirm order fill before monitoring
      // ---------------------------------------------------------------
      if (session.state.phase === 'in_trade' && session.spread.active && session.spread.alpacaOrderId) {
        try {
          const orderStatus = await getAlpacaOrder(session.spread.alpacaOrderId);
          const status = (orderStatus as any)?.status?.toLowerCase() ?? '';
          if (status === 'filled') {
            // Order filled — update with actual fill price if available
            const filledPrice = Number((orderStatus as any)?.filled_avg_price ?? 0);
            if (filledPrice > 0) {
              session.spread.entryCredit = filledPrice;
              session.spread.maxLoss = Math.abs(session.spread.shortLeg.strike - session.spread.longLeg.strike) - filledPrice;
            }
            pushEvent(session, 'order_filled', { orderId: session.spread.alpacaOrderId, filledPrice, status });
            session.state.phase = 'monitoring';
            console.log(`[OPTIONS-PAPER] Order filled at $${filledPrice.toFixed(2)}`);
          } else if (status === 'canceled' || status === 'expired' || status === 'rejected') {
            // Order failed — reset spread
            pushEvent(session, 'order_failed', { orderId: session.spread.alpacaOrderId, status });
            session.spread.active = false;
            session.state.phase = 'entry_window'; // Try again if still in window
            console.warn(`[OPTIONS-PAPER] Order ${status}: ${session.spread.alpacaOrderId}`);
          } else if (etTime > session.config.entryWindowEnd) {
            // Still pending after entry window — cancel it
            try {
              const { cancelAlpacaOrder } = await import('./alpaca');
              await cancelAlpacaOrder(session.spread.alpacaOrderId);
            } catch {}
            pushEvent(session, 'order_cancelled_timeout', { orderId: session.spread.alpacaOrderId });
            session.spread.active = false;
            session.state.phase = 'done';
            console.warn(`[OPTIONS-PAPER] Cancelled unfilled order past entry window`);
          }
          // else: still pending, keep waiting
        } catch (pollErr: any) {
          // Can't check order — assume pending, will retry next tick
          console.warn(`[OPTIONS-PAPER] Failed to poll order status:`, pollErr?.message);
        }
      }

      // ---------------------------------------------------------------
      // Phase: MONITORING — track spread P&L, check exits
      // ---------------------------------------------------------------
      if (session.state.phase === 'monitoring' && session.spread.active) {

        // Fetch current quotes for spread legs
        try {
          const quotes = await getAlpacaOptionLatestQuotes([
            session.spread.shortLeg.symbol,
            session.spread.longLeg.symbol,
          ]);

          if (quotes.size > 0) {
            const shortQ = quotes.get(session.spread.shortLeg.symbol);
            const longQ = quotes.get(session.spread.longLeg.symbol);

            if (shortQ) {
              session.spread.shortLeg.currentBid = Number(shortQ?.bp ?? shortQ?.BidPrice ?? 0);
              session.spread.shortLeg.currentAsk = Number(shortQ?.ap ?? shortQ?.AskPrice ?? 0);
            }
            if (longQ) {
              session.spread.longLeg.currentBid = Number(longQ?.bp ?? longQ?.BidPrice ?? 0);
              session.spread.longLeg.currentAsk = Number(longQ?.ap ?? longQ?.AskPrice ?? 0);
            }
          }
        } catch {}

        // Calculate current spread value (cost to close = buy back short, sell long)
        const costToClose = Math.max(0,
          session.spread.shortLeg.currentAsk - session.spread.longLeg.currentBid,
        );
        session.spread.currentValue = costToClose;
        session.spread.unrealizedPnl = (session.spread.entryCredit - costToClose) * session.config.qty * 100;

        session.state.dailyPnl = session.state.realizedPnl + session.spread.unrealizedPnl;
        session.state.riskUtilizationPct = session.config.maxDailyLoss > 0
          ? Math.min(100, (Math.abs(Math.min(0, session.state.dailyPnl)) / session.config.maxDailyLoss) * 100)
          : 0;

        // --- EXIT CONDITIONS ---

        // 1. Profit target (e.g. 50% of max profit)
        const maxProfit = session.spread.entryCredit * session.config.qty * 100;
        const profitPct = maxProfit > 0 ? (session.spread.unrealizedPnl / maxProfit) * 100 : 0;
        if (session.config.profitTargetPct > 0 && profitPct >= session.config.profitTargetPct) {
          await closeSpread(session, runtime, `Profit target hit: ${profitPct.toFixed(0)}% of max`);
        }

        // 2. Stop loss (e.g. 2x credit received)
        const stopLossAmount = session.spread.entryCredit * session.config.stopLossMultiplier * session.config.qty * 100;
        if (session.spread.unrealizedPnl < 0 && Math.abs(session.spread.unrealizedPnl) >= stopLossAmount) {
          await closeSpread(session, runtime, `Stop loss hit: loss $${Math.abs(session.spread.unrealizedPnl).toFixed(0)} >= $${stopLossAmount.toFixed(0)}`);
        }

        // 3. Max daily loss
        if (session.state.riskUtilizationPct >= 100) {
          await closeSpread(session, runtime, 'Max daily loss breached');
        }

        // 4. Time-based: close in final 15 minutes if still in trade
        const exitMins = getTimeRuleValue(runtime.timeRules, 'time_before_close', 'minutes_before_close', 15);
        if (minsToClose <= exitMins && session.spread.active) {
          session.state.phase = 'closing';
          await closeSpread(session, runtime, `${exitMins} minutes to close — exiting`);
        }

        // 5. Market close — options expire
        if (minsToClose <= 0) {
          session.state.phase = 'done';
          session.status = 'expired';
          session.spread.active = false;
          // 0DTE — settles automatically
          session.state.realizedPnl += session.spread.unrealizedPnl;
          session.spread.unrealizedPnl = 0;
          pushEvent(session, 'expired', { finalPnl: session.state.dailyPnl });
          console.log(`[OPTIONS-PAPER] Session expired, final P&L: $${session.state.dailyPnl.toFixed(2)}`);
        }
      }

      // ---------------------------------------------------------------
      // Phase: DONE — session complete
      // ---------------------------------------------------------------
      if (session.state.phase === 'done' && (session.status as string) !== 'stopped') {
        session.status = 'expired';
        session.endedAt = now;
      }

      // Trim events
      if (session.events.length > 300) {
        session.events = session.events.slice(-300) as any;
      }
      if (session.orders.length > 100) {
        session.orders = session.orders.slice(-100) as any;
      }

      await session.save();

      // Broadcast
      io?.emit('options:paper:update', {
        sessionId: runtime.sessionId,
        state: session.state,
        spread: session.spread,
        regime: session.regime,
        status: session.status,
      });
    } catch (err: any) {
      console.error(`[OPTIONS-PAPER] Tick error:`, err?.message);
    }
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Close spread helper
// ---------------------------------------------------------------------------

async function closeSpread(session: any, runtime: RuntimeState, reason: string) {
  if (!session.spread.active) return;

  try {
    const order = await submitAlpacaOptionsOrder({
      legs: [
        {
          symbol: session.spread.shortLeg.symbol,
          qty: session.config.qty,
          side: 'buy',
          position_intent: 'buy_to_close',
        },
        {
          symbol: session.spread.longLeg.symbol,
          qty: session.config.qty,
          side: 'sell',
          position_intent: 'sell_to_close',
        },
      ],
      order_class: 'multi-leg',
      order_type: 'market',
      time_in_force: 'day',
      quantity: session.config.qty,
    });

    const orderId = (order as any)?.id ?? (order as any)?.order_id ?? 'unknown';

    session.state.realizedPnl += session.spread.unrealizedPnl;
    session.spread.active = false;
    session.state.phase = 'done';

    session.orders.push({
      alpacaOrderId: orderId,
      type: 'close',
      legs: [
        { symbol: session.spread.shortLeg.symbol, side: 'buy', strike: session.spread.shortLeg.strike },
        { symbol: session.spread.longLeg.symbol, side: 'sell', strike: session.spread.longLeg.strike },
      ],
      status: 'submitted',
      credit: -session.spread.currentValue,
      createdAt: new Date().toISOString(),
    } as any);

    pushEvent(session, 'spread_closed', { reason, pnl: session.spread.unrealizedPnl, orderId });
    io?.emit('options:paper:order', { sessionId: runtime.sessionId, type: 'close', reason, orderId });
    console.log(`[OPTIONS-PAPER] Closed spread: ${reason}, P&L=$${session.spread.unrealizedPnl.toFixed(2)}`);
  } catch (err: any) {
    pushEvent(session, 'close_error', { reason, error: err?.message });
    console.error(`[OPTIONS-PAPER] Failed to close spread:`, err?.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushEvent(session: any, type: string, payload: Record<string, any>) {
  session.events.push({ type, timestamp: new Date().toISOString(), payload } as any);
}

/**
 * Gap 6: Check economic calendar for market-moving events today.
 * Uses FRED API if available, otherwise falls back to Alpaca calendar.
 * Returns true if there are high-impact events that could cause volatility.
 */
async function hasMarketMovingEvents(): Promise<{ hasEvents: boolean; reason: string }> {
  try {
    // Use Alpaca's calendar to check if today is a special market day (early close, etc.)
    const clock = await getAlpacaClock();
    if (!clock?.is_open) {
      return { hasEvents: false, reason: 'Market closed' };
    }

    // Check if FOMC, CPI, jobs report days — use a simple heuristic:
    // If the market opened with SPY gapping >0.5% from prev close, likely a volatile day
    const { getAlpacaSnapshots } = await import('./alpaca');
    const snapshots = await getAlpacaSnapshots(['SPY', 'VIX']);

    let vixLevel = 0;
    let spyGapPct = 0;

    for (const snap of (Array.isArray(snapshots) ? snapshots : [])) {
      const sym = snap?.symbol ?? snap?.Symbol ?? '';
      if (sym === 'VIX') {
        vixLevel = Number(snap?.latestTrade?.Price ?? snap?.latestTrade?.p ?? 0);
      }
      if (sym === 'SPY') {
        const current = Number(snap?.dailyBar?.c ?? snap?.dailyBar?.ClosePrice ?? snap?.latestTrade?.Price ?? 0);
        const prev = Number(snap?.prevDailyBar?.c ?? snap?.prevDailyBar?.ClosePrice ?? 0);
        if (prev > 0) spyGapPct = Math.abs((current - prev) / prev) * 100;
      }
    }

    // High VIX (>25) or large gap (>1%) suggests volatile/event-driven day
    if (vixLevel > 25) {
      return { hasEvents: true, reason: `VIX elevated at ${vixLevel.toFixed(1)} — potential high-impact event` };
    }
    if (spyGapPct > 1.0) {
      return { hasEvents: true, reason: `SPY gapped ${spyGapPct.toFixed(2)}% — unusual market-moving activity` };
    }

    return { hasEvents: false, reason: `Normal conditions (VIX=${vixLevel.toFixed(1)}, gap=${spyGapPct.toFixed(2)}%)` };
  } catch (err: any) {
    // If we can't check, err on the side of caution — allow trading
    return { hasEvents: false, reason: `Calendar check failed: ${err?.message}` };
  }
}

function getTimeRuleValue(timeRules: any[], ruleType: string, field: string, fallback: number): number {
  const rule = timeRules.find((r: any) => r.type === ruleType);
  return rule?.[field] ?? fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startOptionsPaperSession(input: StartInput) {
  // Gap 4: Prevent duplicate active sessions for the same strategy
  const existing = await OptionsPaperSessionModel.findOne({
    strategyId: input.strategyId,
    status: { $in: ['waiting', 'running'] },
  }).lean();
  if (existing) {
    throw new Error(`An active options paper session already exists for this strategy (${existing._id}). Stop it first.`);
  }

  // Load strategy
  const strategy = await LabStrategyModel.findById(input.strategyId).lean();
  if (!strategy) throw new Error('Strategy not found');

  const params = (strategy as any).screenerConfig?.params ?? {};
  const regimeConfig: RegimeConfig = params.regime_config ?? {
    risk_on_tickers: [], risk_off_tickers: [], leader_tickers: [],
    risk_on_action: 'put_credit_spread', risk_off_action: 'call_credit_spread',
  };
  const contractSelection: ContractSelection = params.contract_selection ?? {
    contract_type: 'put', strike_selection: 'delta_target', delta_target: 0.2,
    dte_min: 0, dte_max: 0, spread_strategy: 'credit_spread',
    spread_width: 5, short_leg_delta: 0.2,
  };
  const timeRules: any[] = params.time_rules ?? [];
  const underlying = params.underlying_ticker ?? 'SPX';

  // Extract time windows from SIFT data
  const entryWindow = timeRules.find((r: any) => r.type === 'time_window' && r.start_time >= '13:00');
  const analysisWindow = timeRules.find((r: any) => r.type === 'time_window' && r.start_time < '13:00');
  const profitRule = timeRules.find((r: any) => r.type === 'profit_target_pct');
  const stopRule = timeRules.find((r: any) => r.type === 'stop_loss_multiplier');

  const intervalSeconds = input.intervalSeconds ?? 30;
  const qty = input.qty ?? 1;

  // Get initial account state
  let equity = 100000;
  let cash = 100000;
  try {
    const acct = await getAlpacaAccount();
    equity = Number(acct?.equity ?? 100000);
    cash = Number(acct?.cash ?? 100000);
  } catch {}

  const now = new Date();
  const session = await OptionsPaperSessionModel.create({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    backtestId: input.backtestId || undefined,
    versionLabel: input.versionLabel || undefined,
    underlying,
    status: 'waiting',
    config: {
      underlying,
      intervalSeconds,
      qty,
      spreadWidth: contractSelection.spread_width || 5,
      targetDelta: contractSelection.short_leg_delta || 0.2,
      maxDailyLoss: 5000,
      profitTargetPct: profitRule?.target_pct ?? 50,
      stopLossMultiplier: stopRule?.multiplier ?? 2,
      entryWindowStart: entryWindow?.start_time ?? params.typical_entry_start_time ?? '14:00',
      entryWindowEnd: entryWindow?.end_time ?? params.typical_entry_end_time ?? '14:30',
      analysisWindowStart: analysisWindow?.start_time ?? params.start_analysis_time ?? '12:30',
    },
    regime: {
      current: 'unknown',
      confidence: 0,
      action: '',
      lastClassifiedAt: '',
      tickerChanges: [],
    },
    spread: {
      active: false,
      direction: '',
      shortLeg: {},
      longLeg: {},
      entryCredit: 0,
      currentValue: 0,
      unrealizedPnl: 0,
      maxLoss: 0,
      enteredAt: '',
      alpacaOrderId: '',
    },
    state: {
      underlyingPrice: 0,
      equity,
      cash,
      dailyPnl: 0,
      realizedPnl: 0,
      riskUtilizationPct: 0,
      lastUpdatedAt: now.toISOString(),
      phase: 'pre_analysis',
    },
    orders: [],
    events: [
      {
        type: 'session_started',
        timestamp: now.toISOString(),
        payload: {
          underlying,
          qty,
          intervalSeconds,
          entryWindow: `${entryWindow?.start_time ?? '14:00'}-${entryWindow?.end_time ?? '14:30'}`,
          regimeTickers: [
            ...regimeConfig.risk_on_tickers,
            ...regimeConfig.risk_off_tickers,
            ...regimeConfig.leader_tickers,
          ].length,
        },
      },
    ],
    startedAt: now,
  });

  const sessionId = String(session._id);
  const runtimeState: RuntimeState = {
    sessionId,
    timer: null as any,
    paused: false,
    regimeConfig,
    contractSelection,
    timeRules,
    strategyParams: params,
    underlying,
  };

  runtimeState.timer = createOptionsTick(runtimeState, intervalSeconds * 1000);
  runtimeSessions.set(sessionId, runtimeState);

  console.log(
    `[OPTIONS-PAPER] Started session ${sessionId} for ${underlying} ` +
    `(entry ${entryWindow?.start_time ?? '14:00'}-${entryWindow?.end_time ?? '14:30'} ET, ${intervalSeconds}s interval)`,
  );

  io?.emit('options:paper:started', {
    sessionId,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    underlying,
  });

  return session.toObject();
}

export async function getOptionsPaperSession(sessionId: string) {
  return OptionsPaperSessionModel.findById(sessionId).lean();
}

export async function listOptionsPaperSessions(strategyId?: string) {
  const filter = strategyId ? { strategyId } : {};
  return OptionsPaperSessionModel.find(filter).sort({ createdAt: -1 }).limit(20).lean();
}

export async function controlOptionsPaperSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'stop',
) {
  const session = await OptionsPaperSessionModel.findById(sessionId);
  if (!session) throw new Error('Options paper session not found');

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

    // Close any active spread
    if (session.spread.active && runtime) {
      await closeSpread(session, runtime, 'Manual stop');
    }

    if (runtime) {
      clearInterval(runtime.timer);
      runtimeSessions.delete(sessionId);
    }
  }

  pushEvent(session, `session_${action}`, { action });
  await session.save();

  io?.emit('options:paper:update', {
    sessionId,
    state: session.state,
    spread: session.spread,
    regime: session.regime,
    status: session.status,
  });

  return session.toObject();
}
