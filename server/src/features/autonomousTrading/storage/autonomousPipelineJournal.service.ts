import { writeStructuredLog } from '../../../shared/logging/safeLogging';
import { AutonomousPipelineModel } from './autonomousPipeline.model';
import type { AutonomousTradePipelineRecord, AutonomousPipelineTimelineEvent } from '../types/pipelineTypes';

export function serializePipeline(doc: any): AutonomousTradePipelineRecord {
  const raw = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...raw,
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : raw.createdAt,
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt.toISOString() : raw.updatedAt,
  };
}

export async function upsertAutonomousPipeline(record: AutonomousTradePipelineRecord): Promise<AutonomousTradePipelineRecord> {
  const { createdAt: _createdAt, ...setRecord } = record;
  const saved = await AutonomousPipelineModel.findOneAndUpdate(
    { pipelineId: record.pipelineId },
    { $set: { ...setRecord, updatedAt: new Date(record.updatedAt) }, $setOnInsert: { createdAt: new Date(record.createdAt) } },
    { upsert: true, returnDocument: 'after' }
  );
  writeStructuredLog({
    component: 'server',
    module: 'autonomous-trading',
    event: 'PIPELINE_UPSERTED',
    severity: 'info',
    context: {
      pipelineId: record.pipelineId,
      symbol: record.symbol,
      mode: record.mode,
      state: record.state,
      featureFlags: {
        AUTONOMOUS_TRADING_ENABLED: process.env.AUTONOMOUS_TRADING_ENABLED ?? 'false',
        AUTONOMOUS_ENTRY_ENABLED: process.env.AUTONOMOUS_ENTRY_ENABLED ?? 'false',
        AUTONOMOUS_EXIT_ENABLED: process.env.AUTONOMOUS_EXIT_ENABLED ?? 'false',
      },
    },
  });
  return serializePipeline(saved);
}

export async function appendAutonomousPipelineEvent(
  pipelineId: string,
  event: AutonomousPipelineTimelineEvent
): Promise<void> {
  await AutonomousPipelineModel.updateOne(
    { pipelineId },
    { $push: { timeline: event }, $set: { state: event.state, updatedAt: new Date(event.at) } }
  );
}

export async function listAutonomousPipelines(limit = 50): Promise<AutonomousTradePipelineRecord[]> {
  const docs = await AutonomousPipelineModel.find({})
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
  return docs.map(serializePipeline);
}

export async function getAutonomousPipeline(pipelineId: string): Promise<AutonomousTradePipelineRecord | null> {
  const doc = await AutonomousPipelineModel.findOne({ pipelineId }).lean();
  return doc ? serializePipeline(doc) : null;
}
