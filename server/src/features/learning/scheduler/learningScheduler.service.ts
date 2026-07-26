import mongoose from 'mongoose';
import { synchronizeLearningArtifacts } from '../analytics/tradeReview.service';
import { logLearningEvent } from '../journal/learningJournal.service';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastSuccessfulRunAt: Date | null = null;
let lastAttemptAt: Date | null = null;
let lastError: string | null = null;

function intervalMs(): number {
  const configured = Number(process.env.LEARNING_SYNC_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : DEFAULT_INTERVAL_MS;
}

async function runOnce() {
  if (running) return;
  if (mongoose.connection.readyState !== 1) {
    lastError = 'MongoDB disconnected';
    return;
  }
  running = true;
  lastAttemptAt = new Date();
  try {
    const result = await synchronizeLearningArtifacts(500);
    lastSuccessfulRunAt = new Date();
    lastError = null;
    logLearningEvent('LEARNING_ARTIFACT_SYNC_COMPLETED', result);
  } catch (error: any) {
    lastError = error?.message ?? String(error);
    logLearningEvent('LEARNING_ARTIFACT_SYNC_FAILED', { message: lastError });
  } finally {
    running = false;
  }
}

export function startLearningScheduler(): void {
  if (timer || process.env.LEARNING_SYNC_ENABLED === 'false') return;
  void runOnce();
  timer = setInterval(() => void runOnce(), intervalMs());
}

export function stopLearningScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function getLearningSchedulerStatus() {
  return {
    running,
    enabled: process.env.LEARNING_SYNC_ENABLED !== 'false',
    intervalMs: intervalMs(),
    lastSuccessfulRunAt,
    lastAttemptAt,
    lastError,
  };
}
