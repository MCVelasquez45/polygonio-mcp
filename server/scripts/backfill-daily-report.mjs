import 'dotenv/config';
import mongoose from 'mongoose';
import { backfillDailyReportsForDate } from '../dist/features/intelligence/services/dailyReportGenerator.service.js';
import { DailyReportModel } from '../dist/features/intelligence/models/dailyReport.model.js';

const tradingDate = process.argv[2];

if (!tradingDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
  console.error('Usage: npm --prefix server run intelligence:backfill-daily -- YYYY-MM-DD');
  process.exit(1);
}

const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/polygonio-mcp';

try {
  await mongoose.connect(uri);
  await DailyReportModel.syncIndexes();
  const results = await backfillDailyReportsForDate(tradingDate);
  const reports = results.map(result => result.report);
  console.log(
    JSON.stringify(
      {
        tradingDate,
        generated: results.filter(result => !result.idempotent).length,
        existing: results.filter(result => result.idempotent).length,
        reports: reports.map(report => ({
          reportId: report.reportId,
          sessionId: report.sessionId,
          tradingDate: report.tradingDate,
          overallGrade: report.grades.overall.grade,
          netPnl: report.performance.netPnl,
          tradesClosed: report.tradingSummary.tradesClosed,
          wins: report.tradingSummary.wins,
          losses: report.tradingSummary.losses,
          largestWinner: report.performance.largestWinner,
          largestLoser: report.performance.largestLoser,
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
