/**
 * Re-export from strategyBacktest.service.ts for backward compatibility.
 * The backtest engine was renamed from "futures" to "strategy" since it handles
 * credit spreads, iron condors, options, and equities — not just futures.
 */
import {
  type StrategyBacktestInput,
  type StressScenario,
  runStrategyBacktest,
  runStressTest,
  getFuturesBacktest,
} from './strategyBacktest.service';

export type { StrategyBacktestInput, StressScenario };
export type FuturesBacktestInput = StrategyBacktestInput;

export { runStrategyBacktest, runStressTest, getFuturesBacktest };
export const runFuturesBacktest = runStrategyBacktest;
