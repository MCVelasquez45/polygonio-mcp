import mongoose, { Schema, Document } from 'mongoose';

export interface IHandoffRequest extends Document {
  strategyId: string; // ID of the LabStrategy
  requesterId: string;
  status: 'pending' | 'approved' | 'rejected' | 'deployed';

  // The configuration requested for the Engine
  engineConfig: {
    maxCapital: number;
    riskLimits: {
      maxDrawdown: number;
      maxDailyLoss: number;
    };
    symbols: string[];
  };

  // Snapshot of validation proof at time of request
  validationProof: {
    sharpeRatio: number;
    expectedValue: number;
    backtestId: string;
  };

  approvalMeta?: {
    approvedBy: string;
    approvedAt: Date;
    deploymentId?: string; // ID of created EngineStrategy
  };

  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

const HandoffRequestSchema = new Schema({
  strategyId: { type: Schema.Types.ObjectId, ref: 'LabStrategy', required: true },
  requesterId: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'deployed'],
    default: 'pending'
  },
  engineConfig: {
    maxCapital: { type: Number, required: true },
    riskLimits: {
      maxDrawdown: { type: Number, required: true },
      maxDailyLoss: { type: Number, required: true }
    },
    symbols: [{ type: String }]
  },
  validationProof: {
    sharpeRatio: { type: Number, required: true },
    expectedValue: { type: Number, required: true },
    backtestId: { type: String }
  },
  approvalMeta: {
    approvedBy: String,
    approvedAt: Date,
    deploymentId: { type: Schema.Types.ObjectId, ref: 'EngineStrategy' }
  },
  rejectionReason: String
}, {
  timestamps: true
});

export const HandoffRequestModel = mongoose.model<IHandoffRequest>('HandoffRequest', HandoffRequestSchema);
