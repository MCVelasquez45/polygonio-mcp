import { LearningTradeReviewModel } from '../storage/learningTradeReview.model';

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function band(confidence: number | null): string {
  if (confidence == null) return 'UNAVAILABLE';
  const normalized = confidence > 1 ? confidence / 100 : confidence;
  if (normalized < 0.5) return '0-49%';
  if (normalized < 0.65) return '50-64%';
  if (normalized < 0.8) return '65-79%';
  if (normalized < 0.9) return '80-89%';
  return '90-100%';
}

function verdict(predicted: number | null, actual: number | null): 'Overconfident' | 'Underconfident' | 'Well calibrated' | 'Insufficient data' {
  if (predicted == null || actual == null) return 'Insufficient data';
  const error = predicted - actual;
  if (Math.abs(error) <= 0.08) return 'Well calibrated';
  return error > 0 ? 'Overconfident' : 'Underconfident';
}

export async function getLearningConfidenceCalibration() {
  const reviews = await LearningTradeReviewModel.find({}).sort({ exitTimestamp: -1 }).lean();
  const groups = new Map<string, typeof reviews>();
  for (const review of reviews) {
    const key = band(finite(review.confidence));
    groups.set(key, [...(groups.get(key) ?? []), review]);
  }
  const buckets = [...groups.entries()].map(([confidenceBand, group]) => {
    const predictedValues = group.map(review => {
      const value = finite(review.confidence);
      return value != null && value > 1 ? value / 100 : value;
    }).filter((value): value is number => value != null);
    const wins = group.filter(review => review.outcome === 'WIN' || review.outcome === 'PARTIAL_WIN').length;
    const predictedConfidence = predictedValues.length ? predictedValues.reduce((sum, value) => sum + value, 0) / predictedValues.length : null;
    const actualSuccessRate = group.length ? wins / group.length : null;
    return {
      confidenceBand,
      totalTrades: group.length,
      predictedConfidence,
      actualSuccessRate,
      historicalAccuracy: actualSuccessRate,
      calibrationError: predictedConfidence != null && actualSuccessRate != null ? predictedConfidence - actualSuccessRate : null,
      verdict: verdict(predictedConfidence, actualSuccessRate),
    };
  });
  return { generatedAt: new Date().toISOString(), buckets };
}
