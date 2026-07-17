import mongoose, { Document, Schema } from 'mongoose';

// Durable MANUAL order intent — the record that makes a manual paper trade
// deliberate and idempotent. A contract selection creates a CREATED intent; an
// explicit user action CONFIRMs it; submission (through the execution gateway)
// produces exactly one broker order. Manual and automated execution are kept in
// SEPARATE stores so neither can borrow the other's authority.

export type ManualIntentStatus = 'CREATED' | 'CONFIRMED' | 'SUBMITTING' | 'SUBMITTED' | 'REJECTED' | 'FAILED';
export type ManualIntentAction = 'OPEN_ORDER' | 'CLOSE_POSITION';

export interface ManualOrderIntentDocument extends Document {
  // Execution authority is explicit and fixed for this record.
  executionMode: 'MANUAL';
  orderSource: 'MANUAL_UI';
  action: ManualIntentAction;
  status: ManualIntentStatus;

  // The reviewed order (normalized broker request).
  optionSymbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  brokerPositionQuantity: number | null;
  orderType: string;
  limitPrice: number | null;
  timeInForce: string;
  order: Record<string, unknown>;
  /** Hash of `order` at CONFIRM time — submission rejects if the payload changed. */
  payloadHash: string;

  // Broker linkage.
  clientOrderId: string | null;
  brokerOrderId: string | null;
  attemptCount: number;

  // Provenance (never used as authorization).
  requestedByUserId: string | null;
  /** Market-data provenance only (e.g. 'massive'); NOT execution authorization. */
  marketDataSource: string | null;

  confirmedAt: Date | null;
  submittedAt: Date | null;
  rejectionReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const STATUSES: ManualIntentStatus[] = ['CREATED', 'CONFIRMED', 'SUBMITTING', 'SUBMITTED', 'REJECTED', 'FAILED'];
const ACTIONS: ManualIntentAction[] = ['OPEN_ORDER', 'CLOSE_POSITION'];

const ManualOrderIntentSchema = new Schema<ManualOrderIntentDocument>(
  {
    executionMode: { type: String, enum: ['MANUAL'], required: true, default: 'MANUAL' },
    orderSource: { type: String, enum: ['MANUAL_UI'], required: true, default: 'MANUAL_UI' },
    action: { type: String, enum: ACTIONS, required: true, default: 'OPEN_ORDER' },
    status: { type: String, enum: STATUSES, required: true, default: 'CREATED', index: true },

    optionSymbol: { type: String, required: true, uppercase: true, trim: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    quantity: { type: Number, required: true, min: 1 },
    brokerPositionQuantity: { type: Number, default: null },
    orderType: { type: String, required: true },
    limitPrice: { type: Number, default: null },
    timeInForce: { type: String, required: true, default: 'day' },
    order: { type: Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },

    clientOrderId: { type: String, default: null },
    brokerOrderId: { type: String, default: null },
    attemptCount: { type: Number, required: true, default: 0 },

    requestedByUserId: { type: String, default: null },
    marketDataSource: { type: String, default: null },

    confirmedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'manual_order_intents' }
);

ManualOrderIntentSchema.index({ status: 1, createdAt: -1 });

export const ManualOrderIntentModel =
  (mongoose.models.ManualOrderIntent as mongoose.Model<ManualOrderIntentDocument>) ||
  mongoose.model<ManualOrderIntentDocument>('ManualOrderIntent', ManualOrderIntentSchema);
