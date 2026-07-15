import mongoose, { Document, Schema } from 'mongoose';
import { AUTOMATION_COLLECTIONS } from '../automation/automation.constants';

// Sprint 2E — the Watchlist is the SINGLE SOURCE OF TRUTH for the automation
// universe. One document per symbol. The automation scheduler asks the Watchlist
// Service (via the cached Automation Universe Provider) for its universe every
// cycle; there is no env symbol list and no hardcoded array anywhere else.
//
// Schema is additive-only: every field below is new (there was no prior
// server-side watchlist), and future strategies extend `strategy` — they never
// remove fields.

/** The only strategy wired today. The field exists so the architecture is
 *  ready for EQUITY_MOMENTUM / VOLATILITY_BREAKOUT / NEWS_EVENT / GPT_RESEARCH_ONLY
 *  WITHOUT a schema change — those are intentionally NOT implemented yet. */
export const WATCHLIST_STRATEGIES = [
  'OPTIONS_NATIVE_FLOW',
  'EQUITY_MOMENTUM',
  'VOLATILITY_BREAKOUT',
  'NEWS_EVENT',
  'GPT_RESEARCH_ONLY',
] as const;
export type WatchlistStrategy = (typeof WATCHLIST_STRATEGIES)[number];

/** The only strategy the scheduler will actually evaluate this sprint. */
export const ACTIVE_WATCHLIST_STRATEGY: WatchlistStrategy = 'OPTIONS_NATIVE_FLOW';

// Live automation status for the UI control center (telemetry only — never a
// gate). Evaluation-phase states are written by the evaluator; the
// broker-truth lifecycle states (ORDER_SUBMITTED..POSITION_CLOSED) are DERIVED
// AT READ TIME from the AutomationPosition collection — never from intent
// status — so the dashboard reflects the broker, not an approval.
export const WATCHLIST_AUTOMATION_STATUSES = [
  'DISABLED', // automationEnabled=false
  'WAITING_FOR_BASELINE', // first window: baseline persisted, no trade yet
  'MONITORING', // evaluated, no signal
  'EVALUATING', // signal found, being ranked/risked
  'INTENT_APPROVED', // risk approved; NO broker-confirmed position yet
  'ORDER_SUBMITTED', // broker submission exists (PENDING_ENTRY)
  'PARTIALLY_FILLED', // broker truth reports a partial entry fill
  'POSITION_OPEN', // broker truth: durable open automation position
  'EXITING', // exit intent / broker exit active
  'POSITION_CLOSED', // broker truth confirms full close
  'MANUAL_REVIEW', // ambiguous/unresolved — operator attention
] as const;
export type WatchlistAutomationStatus = (typeof WATCHLIST_AUTOMATION_STATUSES)[number];

export interface WatchlistItemDocument extends Document {
  symbol: string;
  enabled: boolean;
  automationEnabled: boolean;
  priority: number;
  strategy: WatchlistStrategy;
  minConfidence: number;
  maxPositionSize: number;
  /** Percent (e.g. 10 = 10%). Converted to a fraction for the contract filter. */
  maxSpreadPercent: number;
  maxDTE: number;
  minDTE: number;
  notes?: string;
  // --- UI telemetry (set by the evaluator; never influences a decision) ---
  automationStatus: WatchlistAutomationStatus;
  lastEvaluationAt: Date | null;
  lastSignal: 'BULLISH' | 'BEARISH' | 'NO_TRADE' | 'DATA_REJECTED' | 'BASELINE' | null;
  lastSignalAt: Date | null;
  lastTradeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const WatchlistItemSchema = new Schema<WatchlistItemDocument>(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true, unique: true },
    enabled: { type: Boolean, required: true, default: true },
    automationEnabled: { type: Boolean, required: true, default: false },
    priority: { type: Number, required: true, default: 100 },
    strategy: { type: String, enum: WATCHLIST_STRATEGIES, required: true, default: ACTIVE_WATCHLIST_STRATEGY },
    minConfidence: { type: Number, required: true, default: 0.5 },
    maxPositionSize: { type: Number, required: true, default: 1 },
    maxSpreadPercent: { type: Number, required: true, default: 10 },
    maxDTE: { type: Number, required: true, default: 21 },
    minDTE: { type: Number, required: true, default: 7 },
    notes: { type: String, default: undefined },
    automationStatus: { type: String, enum: WATCHLIST_AUTOMATION_STATUSES, required: true, default: 'DISABLED' },
    lastEvaluationAt: { type: Date, default: null },
    lastSignal: { type: String, enum: ['BULLISH', 'BEARISH', 'NO_TRADE', 'DATA_REJECTED', 'BASELINE', null], default: null },
    lastSignalAt: { type: Date, default: null },
    lastTradeAt: { type: Date, default: null },
  },
  { timestamps: true, collection: AUTOMATION_COLLECTIONS.watchlist }
);

// Priority-first ordering is load-bearing for deterministic universe ranking.
WatchlistItemSchema.index({ enabled: 1, automationEnabled: 1, priority: 1, symbol: 1 });

export const WatchlistItemModel =
  (mongoose.models.WatchlistItem as mongoose.Model<WatchlistItemDocument>) ||
  mongoose.model<WatchlistItemDocument>('WatchlistItem', WatchlistItemSchema);
