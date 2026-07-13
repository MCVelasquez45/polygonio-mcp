import mongoose, { Document, Schema } from 'mongoose';
import { AUTOMATION_COLLECTIONS } from '../automation.constants';
import type {
  AutomationMode,
  AutomationSessionStatus,
  ReconciliationStatus,
  SessionHealthStatus,
} from '../automation.types';

// Persistent automation session. Carries everything needed to recover safely
// after a process restart — no runnable state lives only in memory.

export interface AutomationSessionDocument extends Document {
  mode: AutomationMode;
  strategyVersionId: string;
  underlying: string;
  status: AutomationSessionStatus;
  healthStatus: SessionHealthStatus;
  lastProcessedClosedBarTs: Date | null;
  dailyTradeCount: number;
  consecutiveLossCount: number;
  dailyRealizedPnl: number;
  currentDrawdown: number;
  reconciliationStatus: ReconciliationStatus;
  lastReconciledAt: Date | null;
  pauseReason: string | null;
  emergencyStop: {
    active: boolean;
    reason: string | null;
    at: Date | null;
  };
  startedAt: Date | null;
  pausedAt: Date | null;
  stoppedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SESSION_STATUSES: AutomationSessionStatus[] = [
  'CREATED',
  'READY',
  'PAUSED',
  'STOPPED',
  'EMERGENCY_STOPPED',
  'UNAVAILABLE',
];

const AutomationSessionSchema = new Schema<AutomationSessionDocument>(
  {
    mode: { type: String, enum: ['paper'], required: true, default: 'paper' },
    strategyVersionId: { type: String, required: true },
    underlying: { type: String, required: true, uppercase: true, trim: true },
    status: { type: String, enum: SESSION_STATUSES, required: true, default: 'CREATED', index: true },
    healthStatus: {
      type: String,
      enum: ['HEALTHY', 'DEGRADED', 'UNAVAILABLE'],
      required: true,
      default: 'UNAVAILABLE',
    },
    lastProcessedClosedBarTs: { type: Date, default: null },
    dailyTradeCount: { type: Number, required: true, default: 0 },
    consecutiveLossCount: { type: Number, required: true, default: 0 },
    dailyRealizedPnl: { type: Number, required: true, default: 0 },
    currentDrawdown: { type: Number, required: true, default: 0 },
    reconciliationStatus: {
      type: String,
      enum: ['PENDING', 'CLEAN', 'MISMATCH', 'MANUAL_REVIEW', 'FAILED'],
      required: true,
      default: 'PENDING',
    },
    lastReconciledAt: { type: Date, default: null },
    pauseReason: { type: String, default: null },
    emergencyStop: {
      active: { type: Boolean, required: true, default: false },
      reason: { type: String, default: null },
      at: { type: Date, default: null },
    },
    startedAt: { type: Date, default: null },
    pausedAt: { type: Date, default: null },
    stoppedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: AUTOMATION_COLLECTIONS.sessions }
);

AutomationSessionSchema.index({ status: 1, updatedAt: -1 });
AutomationSessionSchema.index({ underlying: 1, status: 1 });

export const AutomationSessionModel =
  (mongoose.models.AutomationSession as mongoose.Model<AutomationSessionDocument>) ||
  mongoose.model<AutomationSessionDocument>('AutomationSession', AutomationSessionSchema);

/** Statuses eligible for recovery/reconciliation at boot. */
export const RECOVERABLE_SESSION_STATUSES: AutomationSessionStatus[] = ['READY', 'PAUSED'];

/** A session may act only in these statuses — and only when Mongo is up. */
export const RUNNABLE_SESSION_STATUSES: AutomationSessionStatus[] = ['READY'];
