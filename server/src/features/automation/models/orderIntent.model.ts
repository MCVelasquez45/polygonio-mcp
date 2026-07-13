import mongoose, { Document, Schema } from 'mongoose';
import { AUTOMATION_COLLECTIONS } from '../automation.constants';
import type {
  IntentDirection,
  IntentOrderType,
  IntentTimeInForce,
  IntentType,
  OrderIntentStatus,
} from '../automation.types';

// Order-intent journal. An intent is written and durable BEFORE any broker
// request is attempted; the idempotency key makes duplicate creation
// structurally impossible (unique index), so one signal can never become two
// broker orders.

export interface OrderIntentDocument extends Document {
  automationSessionId: string;
  strategyVersionId: string;
  underlying: string;
  optionSymbol: string | null;
  intentType: IntentType;
  direction: IntentDirection;
  quantity: number;
  orderType: IntentOrderType;
  limitPrice: number | null;
  timeInForce: IntentTimeInForce;
  status: OrderIntentStatus;
  idempotencyKey: string;
  /** Deterministic client_order_id sent to the broker (derived from the key). */
  clientOrderId: string;
  /** Raw inputs the key was derived from — for audit/debugging. */
  idempotencyInputs: {
    automationSessionId: string;
    strategyVersionId: string;
    underlying: string;
    signalDirection: IntentDirection;
    closedBarTimestamp: string;
    intentType: IntentType;
  };
  brokerOrderId: string | null;
  rejectionReason: string | null;
  attemptCount: number;
  lastReconciledAt: Date | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const INTENT_STATUSES: OrderIntentStatus[] = [
  'CREATED',
  'SUBMITTING',
  'SUBMITTED',
  'BROKER_REJECTED',
  'FAILED',
  'MANUAL_REVIEW',
  'COMPLETED',
];

const OrderIntentSchema = new Schema<OrderIntentDocument>(
  {
    automationSessionId: { type: String, required: true, index: true },
    strategyVersionId: { type: String, required: true },
    underlying: { type: String, required: true, uppercase: true, trim: true },
    optionSymbol: { type: String, default: null },
    intentType: { type: String, enum: ['ENTRY', 'EXIT'], required: true },
    direction: { type: String, enum: ['BUY', 'SELL'], required: true },
    quantity: { type: Number, required: true, min: 1 },
    orderType: { type: String, enum: ['market', 'limit'], required: true },
    limitPrice: { type: Number, default: null },
    timeInForce: { type: String, enum: ['day', 'gtc'], required: true },
    status: { type: String, enum: INTENT_STATUSES, required: true, default: 'CREATED', index: true },
    idempotencyKey: { type: String, required: true },
    clientOrderId: { type: String, required: true },
    idempotencyInputs: {
      automationSessionId: { type: String, required: true },
      strategyVersionId: { type: String, required: true },
      underlying: { type: String, required: true },
      signalDirection: { type: String, required: true },
      closedBarTimestamp: { type: String, required: true },
      intentType: { type: String, required: true },
    },
    brokerOrderId: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    attemptCount: { type: Number, required: true, default: 0 },
    lastReconciledAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: AUTOMATION_COLLECTIONS.orderIntents }
);

// THE idempotency guarantee. Never remove or relax this index.
OrderIntentSchema.index({ idempotencyKey: 1 }, { unique: true });
OrderIntentSchema.index({ clientOrderId: 1 });
OrderIntentSchema.index({ automationSessionId: 1, createdAt: -1 });

export const OrderIntentModel =
  (mongoose.models.AutomationOrderIntent as mongoose.Model<OrderIntentDocument>) ||
  mongoose.model<OrderIntentDocument>('AutomationOrderIntent', OrderIntentSchema);

/** Intent statuses that reconciliation must inspect after a restart. */
export const UNRESOLVED_INTENT_STATUSES: OrderIntentStatus[] = ['CREATED', 'SUBMITTING', 'SUBMITTED'];
