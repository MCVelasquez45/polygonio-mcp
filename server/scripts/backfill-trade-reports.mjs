import 'dotenv/config';
import mongoose from 'mongoose';
import { backfillTradeReportsForDate } from '../dist/features/intelligence/services/tradeReportGenerator.service.js';
import { TradeReportModel } from '../dist/features/intelligence/models/tradeReport.model.js';

const tradingDate = process.argv[2];

if (!tradingDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
  console.error('Usage: npm --prefix server run intelligence:backfill-trades -- YYYY-MM-DD');
  process.exit(1);
}

const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/polygonio-mcp';

try {
  await mongoose.connect(uri);
  await TradeReportModel.syncIndexes();
  const results = await backfillTradeReportsForDate(tradingDate);
  const reports = results.map(result => result.report);
  console.log(
    JSON.stringify(
      {
        tradingDate,
        generated: results.filter(result => !result.idempotent).length,
        existing: results.filter(result => result.idempotent).length,
        reports: reports.map(report => ({
          reportId: report.reportId,
          tradeId: report.tradeId,
          underlying: report.identity.underlying,
          direction: report.identity.direction,
          exitReason: report.lifecycle.exitReason,
          realizedPnl: report.performance.realizedPnl,
          overallGrade: report.grades.overall.grade,
          warnings: report.warnings.map(warning => warning.code),
        })),
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect();
}
