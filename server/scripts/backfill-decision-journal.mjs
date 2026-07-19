import 'dotenv/config';
import mongoose from 'mongoose';
import { backfillDecisionJournalForDate } from '../dist/features/intelligence/services/decisionJournal.service.js';
import { DecisionJournalModel } from '../dist/features/intelligence/models/decisionJournal.model.js';

const tradingDate = process.argv[2];

if (!tradingDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
  console.error('Usage: npm --prefix server run intelligence:backfill-decisions -- YYYY-MM-DD');
  process.exit(1);
}

const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/polygonio-mcp';

try {
  await mongoose.connect(uri);
  await DecisionJournalModel.syncIndexes();
  const results = await backfillDecisionJournalForDate(tradingDate);
  const typeCounts = results.reduce((counts, result) => {
    const type = result.entry.decisionType;
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  console.log(
    JSON.stringify(
      {
        tradingDate,
        generated: results.filter(result => !result.idempotent).length,
        existing: results.filter(result => result.idempotent).length,
        entryCount: results.length,
        typeCounts,
        sampleEntries: results.slice(0, 25).map(result => ({
          decisionId: result.entry.decisionId,
          timestamp: result.entry.timestamp,
          decisionType: result.entry.decisionType,
          symbol: result.entry.context.symbol,
          contract: result.entry.context.contract,
          approved: result.entry.decision.approved,
          rejected: result.entry.decision.rejected,
          skipped: result.entry.decision.skipped,
          reasonCodes: result.entry.decision.reasonCodes,
        })),
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect();
}
