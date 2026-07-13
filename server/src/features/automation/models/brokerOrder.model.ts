import mongoose, { Document, Schema } from 'mongoose';
import { AUTOMATION_COLLECTIONS } from '../automation.constants';
import type { BrokerOrderStatus, IntentDirection } from '../automation.types';

// Broker-order journal: broker truth, persisted separately from local intent.
//
// INVARIANT: `status` transitions are driven exclusively by broker responses
// (submit acks, order polls, reconciliation snapshots). There is deliberately
// no API here that accepts an internally-derived fill state — see
// automationAudit + orderIntent.service `recordBrokerOrderSnapshot`, the sole
// writer, which requires the broker payload itself.

export interface BrokerOrderDocument extends Document {
  brokerOrderId: string;
  clientOrderId: string | null;
  intentId: string | null;
  automationSessionId: string | null;
  symbol: string;
  side: IntentDirection;
  qty: number;
  filledQty: number;
  avgFillPrice: number | null;
  status: BrokerOrderStatus;
  rawStatus: string;
  orderType: string;
  limitPrice: number | null;
  timeInForce: string;
  /** How this snapshot reached us — always a broker-derived path. */
  lastSource: 'submit-response' | 'order-poll' | 'reconciliation' | 'manual-review';
  submittedAt: Date | null;
  lastBrokerUpdateAt: Date | null;
  statusHistory: Array<{
    at: Date;
    status: BrokerOrderStatus;
    rawStatus: string;
    source: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export const BROKER_ORDER_STATUSES: BrokerOrderStatus[] = [
  'CREATED',
  'SUBMITTING',
  'ACCEPTED',
  'PENDING_NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'REPLACED',
  'UNKNOWN',
  'MANUAL_REVIEW',
];

const BrokerOrderSchema = new Schema<BrokerOrderDocument>(
  {
    brokerOrderId: { type: String, required: true },
    clientOrderId: { type: String, default: null },
    intentId: { type: String, default: null, index: true },
    automationSessionId: { type: String, default: null, index: true },
    symbol: { type: String, required: true },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    qty: { type: Number, required: true },
    filledQty: { type: Number, required: true, default: 0 },
    avgFillPrice: { type: Number, default: null },
    status: { type: String, enum: BROKER_ORDER_STATUSES, required: true },
    rawStatus: { type: String, required: true },
    orderType: { type: String, required: true },
    limitPrice: { type: Number, default: null },
    timeInForce: { type: String, required: true },
    lastSource: {
      type: String,
      enum: ['submit-response', 'order-poll', 'reconciliation', 'manual-review'],
      required: true,
    },
    submittedAt: { type: Date, default: null },
    lastBrokerUpdateAt: { type: Date, default: null },
    statusHistory: [
      {
        at: { type: Date, required: true },
        status: { type: String, enum: BROKER_ORDER_STATUSES, required: true },
        rawStatus: { type: String, required: true },
        source: { type: String, required: true },
      },
    ],
  },
  { timestamps: true, collection: AUTOMATION_COLLECTIONS.brokerOrders }
);

BrokerOrderSchema.index({ brokerOrderId: 1 }, { unique: true });
BrokerOrderSchema.index({ clientOrderId: 1 });
BrokerOrderSchema.index({ automationSessionId: 1, updatedAt: -1 });

export const BrokerOrderModel =
  (mongoose.models.AutomationBrokerOrder as mongoose.Model<BrokerOrderDocument>) ||
  mongoose.model<BrokerOrderDocument>('AutomationBrokerOrder', BrokerOrderSchema);
