import mongoose, { Document, Schema } from 'mongoose';

// Sprint 2D — the restart-durable options-flow baseline.
//
// The options-native signal differences cumulative day option volume between
// two chain snapshots taken one observation window apart. The EARLIER snapshot
// (the baseline) must survive process restarts so the first window after a
// restart is deterministically skipped rather than diffed against nothing (or
// against a snapshot from a different trading day). Exactly ONE latest snapshot
// is kept per (session, underlying) — upserted every completed window.

export type OptionsFlowSnapshotContract = {
  symbol: string;
  type: 'call' | 'put';
  mid: number | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  openInterest: number | null;
  volume: number | null;
  expiration: string | null;
  quoteTimestamp: number | null;
};

export interface OptionsFlowSnapshotDocument extends Document {
  automationSessionId: string;
  underlying: string;
  /** Provider/observation instant this snapshot represents. */
  capturedAt: Date;
  /** Exchange trading date (America/New_York) — a baseline is only valid intraday. */
  tradingDate: string;
  /** Scheduler window key at capture (audit; also detects same-window reuse). */
  windowKey: string | null;
  /** Delayed underlying price from the options snapshot (context only). */
  underlyingPrice: number | null;
  /** Pagination completeness of the captured window. */
  complete: boolean;
  contracts: OptionsFlowSnapshotContract[];
  createdAt: Date;
  updatedAt: Date;
}

const OptionsFlowSnapshotSchema = new Schema<OptionsFlowSnapshotDocument>(
  {
    automationSessionId: { type: String, required: true },
    underlying: { type: String, required: true, uppercase: true, trim: true },
    capturedAt: { type: Date, required: true },
    tradingDate: { type: String, required: true },
    windowKey: { type: String, default: null },
    underlyingPrice: { type: Number, default: null },
    complete: { type: Boolean, required: true, default: true },
    contracts: { type: [Schema.Types.Mixed] as any, required: true, default: [] },
  },
  { timestamps: true, collection: 'automation_options_flow_snapshots' }
);

// Exactly one latest baseline per (session, underlying).
OptionsFlowSnapshotSchema.index({ automationSessionId: 1, underlying: 1 }, { unique: true });

export const OptionsFlowSnapshotModel =
  (mongoose.models.AutomationOptionsFlowSnapshot as mongoose.Model<OptionsFlowSnapshotDocument>) ||
  mongoose.model<OptionsFlowSnapshotDocument>('AutomationOptionsFlowSnapshot', OptionsFlowSnapshotSchema);
