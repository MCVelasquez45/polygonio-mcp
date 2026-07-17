import mongoose, { Document, Schema } from 'mongoose';

// Phase 2C — database-backed scheduler ownership lease.
//
// In a single-instance deployment (and defensively beyond it) exactly one
// scheduler owner may drive a given scope. The unique `scope` key plus a TTL
// expiry means a second Node process cannot acquire the same lease while it is
// held, so two processes can never submit the same trade. A crashed owner's
// lease simply expires and is reclaimable.

export interface SchedulerLeaseDocument extends Document {
  scope: string; // e.g. 'automation-scheduler'
  ownerId: string; // unique per process/runtime
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SchedulerLeaseSchema = new Schema<SchedulerLeaseDocument>(
  {
    scope: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    acquiredAt: { type: Date, required: true },
    renewedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'automation_scheduler_leases' }
);

export const SchedulerLeaseModel =
  (mongoose.models.AutomationSchedulerLease as mongoose.Model<SchedulerLeaseDocument>) ||
  mongoose.model<SchedulerLeaseDocument>('AutomationSchedulerLease', SchedulerLeaseSchema);

/**
 * Try to acquire or renew the lease for `scope` as `ownerId`. Returns true when
 * this owner holds the lease afterward. An unexpired lease held by a different
 * owner blocks acquisition (single-owner guarantee).
 */
export async function acquireSchedulerLease(
  scope: string,
  ownerId: string,
  ttlMs: number,
  now: Date = new Date()
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    // Same owner → renew. Different owner → only if the current lease expired.
    const res = await SchedulerLeaseModel.findOneAndUpdate(
      { scope, $or: [{ ownerId }, { expiresAt: { $lte: now } }] },
      { $set: { ownerId, renewedAt: now, expiresAt }, $setOnInsert: { scope, acquiredAt: now } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true }
    );
    const doc = res.value as SchedulerLeaseDocument | null;
    return doc?.ownerId === ownerId;
  } catch (error: any) {
    // Duplicate-key: another owner holds an unexpired lease. Not ours.
    if (error?.code === 11000) return false;
    throw error;
  }
}

/** Release the lease if (and only if) this owner holds it. */
export async function releaseSchedulerLease(scope: string, ownerId: string): Promise<void> {
  await SchedulerLeaseModel.deleteOne({ scope, ownerId });
}
