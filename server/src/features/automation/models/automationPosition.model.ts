import mongoose, { Document, Schema } from 'mongoose';
import type { SignalDirection } from './tradeCandidate.model';

// Phase 2C — the durable automation-owned position record. It threads the full
// lifecycle: session → universe evaluation → candidate → selection → risk →
// entry intent → entry broker order → fills → monitoring → exit intent →
// exit broker order → realized P&L. Ownership is ALWAYS explicit: automation
// may only manage a position it can prove it opened (linked entry intent +
// client_order_id). Manual positions are never represented here.

export type PositionSource = 'AUTOMATION';

export type AutomationPositionStatus =
  | 'PENDING_ENTRY' // entry intent submitted, no confirmed fill yet
  | 'OPEN' // confirmed fill, actively monitored
  | 'EXITING' // exit intent submitted, awaiting close
  | 'CLOSED' // broker-confirmed flat, realized P&L computed
  | 'MANUAL_REVIEW'; // ambiguous/unresolved — needs operator attention

export type ExitReason =
  | 'EMERGENCY_STOP'
  | 'END_OF_DAY'
  | 'HARD_STOP'
  | 'BROKER_MANUAL_CLOSE'
  | 'OPERATOR_CLOSE'
  | 'PROFIT_TARGET'
  | 'STRATEGY_INVALIDATION';

export interface AutomationPositionDocument extends Document {
  source: PositionSource;
  automationSessionId: string;
  strategyVersionId: string;
  universeEvaluationId: string | null;
  tradeCandidateId: string | null;
  contractSelectionId: string | null;
  riskDecisionId: string | null;

  underlying: string;
  optionSymbol: string;
  direction: SignalDirection;

  // Entry
  entryIntentId: string;
  entryBrokerOrderId: string | null;
  entryClientOrderId: string;
  filledQty: number;
  avgEntryPrice: number | null;
  entryFees: number | null;
  openedAt: Date | null;

  // Monitoring
  status: AutomationPositionStatus;
  currentMark: number | null;
  unrealizedPnl: number | null;
  lastMarkAt: Date | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;

  // Exit policy snapshotted at entry-fill time (immutable for this trade)
  exitPolicy: {
    stopLossPct: number;
    profitTargetPct: number;
    trailingEnabled: boolean;
    stopPrice: number | null;
    targetPrice: number | null;
  } | null;

  // Exit
  exitReason: ExitReason | null;
  exitIntentId: string | null;
  exitBrokerOrderId: string | null;
  avgExitPrice: number | null;
  exitFees: number | null;
  realizedPnl: number | null;
  returnPct: number | null;
  closedAt: Date | null;
  /** True once this close has been folded into session risk counters (once only). */
  riskCounted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const STATUSES: AutomationPositionStatus[] = [
  'PENDING_ENTRY',
  'OPEN',
  'EXITING',
  'CLOSED',
  'MANUAL_REVIEW',
];

const EXIT_REASONS: ExitReason[] = [
  'EMERGENCY_STOP',
  'END_OF_DAY',
  'HARD_STOP',
  'BROKER_MANUAL_CLOSE',
  'OPERATOR_CLOSE',
  'PROFIT_TARGET',
  'STRATEGY_INVALIDATION',
];

const AutomationPositionSchema = new Schema<AutomationPositionDocument>(
  {
    source: { type: String, enum: ['AUTOMATION'], required: true, default: 'AUTOMATION' },
    automationSessionId: { type: String, required: true, index: true },
    strategyVersionId: { type: String, required: true },
    universeEvaluationId: { type: String, default: null },
    tradeCandidateId: { type: String, default: null },
    contractSelectionId: { type: String, default: null },
    riskDecisionId: { type: String, default: null },

    underlying: { type: String, required: true, uppercase: true, trim: true },
    optionSymbol: { type: String, required: true, uppercase: true, trim: true },
    direction: { type: String, enum: ['BULLISH', 'BEARISH'], required: true },

    entryIntentId: { type: String, required: true },
    entryBrokerOrderId: { type: String, default: null },
    // Unique: one automation position per entry order. The idempotent entry
    // intent already guarantees one order; this guarantees one position.
    entryClientOrderId: { type: String, required: true, unique: true },
    filledQty: { type: Number, required: true, default: 0 },
    avgEntryPrice: { type: Number, default: null },
    entryFees: { type: Number, default: null },
    openedAt: { type: Date, default: null },

    status: { type: String, enum: STATUSES, required: true, default: 'PENDING_ENTRY', index: true },
    currentMark: { type: Number, default: null },
    unrealizedPnl: { type: Number, default: null },
    lastMarkAt: { type: Date, default: null },
    maxFavorableExcursion: { type: Number, default: null },
    maxAdverseExcursion: { type: Number, default: null },

    exitPolicy: {
      type: new Schema(
        {
          stopLossPct: { type: Number, required: true },
          profitTargetPct: { type: Number, required: true },
          trailingEnabled: { type: Boolean, required: true },
          stopPrice: { type: Number, default: null },
          targetPrice: { type: Number, default: null },
        },
        { _id: false }
      ),
      default: null,
    },

    exitReason: { type: String, enum: [...EXIT_REASONS, null], default: null },
    exitIntentId: { type: String, default: null },
    exitBrokerOrderId: { type: String, default: null },
    avgExitPrice: { type: Number, default: null },
    exitFees: { type: Number, default: null },
    realizedPnl: { type: Number, default: null },
    returnPct: { type: Number, default: null },
    closedAt: { type: Date, default: null },
    riskCounted: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: 'automation_positions' }
);

AutomationPositionSchema.index({ automationSessionId: 1, status: 1 });
AutomationPositionSchema.index({ optionSymbol: 1, status: 1 });

export const AutomationPositionModel =
  (mongoose.models.AutomationPosition as mongoose.Model<AutomationPositionDocument>) ||
  mongoose.model<AutomationPositionDocument>('AutomationPosition', AutomationPositionSchema);

/** Positions that still need active management (mark/exit/reconcile). */
export const LIVE_POSITION_STATUSES: AutomationPositionStatus[] = ['PENDING_ENTRY', 'OPEN', 'EXITING'];
