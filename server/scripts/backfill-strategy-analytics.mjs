import 'dotenv/config';
import mongoose from 'mongoose';
import {
  backfillStrategyAnalyticsForDate,
  generateStrategyAnalyticsForWindowType,
  validateWindowType,
} from '../dist/features/intelligence/services/strategyAnalytics.service.js';
import { StrategyAnalyticsModel } from '../dist/features/intelligence/models/strategyAnalytics.model.js';

const tradingDate = process.argv[2];
const windowTypeArg = process.argv[3];

if (!tradingDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
  console.error('Usage: npm --prefix server run intelligence:backfill-analytics -- YYYY-MM-DD [DAILY|WEEKLY|MONTHLY|ROLLING]');
  process.exit(1);
}

const windowType = windowTypeArg ? validateWindowType(windowTypeArg) : null;
const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/polygonio-mcp';

try {
  await mongoose.connect(uri);
  await StrategyAnalyticsModel.syncIndexes();
  const results = windowType
    ? [await generateStrategyAnalyticsForWindowType(windowType, tradingDate)]
    : await backfillStrategyAnalyticsForDate(tradingDate);
  console.log(
    JSON.stringify(
      {
        tradingDate,
        windowType: windowType ?? 'ALL',
        generated: results.filter(result => !result.idempotent).length,
        existing: results.filter(result => result.idempotent).length,
        analytics: results.map(result => ({
          analyticsId: result.analytics.analyticsId,
          windowType: result.analytics.windowType,
          windowStart: result.analytics.windowStart,
          windowEnd: result.analytics.windowEnd,
          totalTrades: result.analytics.performance.totalTrades,
          netPnl: result.analytics.performance.netPnl,
          winRate: result.analytics.performance.winRate,
          evidenceScore: result.analytics.evidenceQuality.availableEvidencePercent,
          warnings: result.analytics.warnings.map(warning => warning.code),
        })),
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect();
}
