import { listLearningDatasets } from '../analytics/tradeReview.service';

export async function getLearningDatasets(limit = 100) {
  const datasets = await listLearningDatasets(limit);
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    datasets,
  };
}
