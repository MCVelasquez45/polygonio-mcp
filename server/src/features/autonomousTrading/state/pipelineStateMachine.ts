import type {
  AutonomousPipelineRelatedRecord,
  AutonomousPipelineState,
  AutonomousPipelineTimelineEvent,
} from '../types/pipelineTypes';

const VALID_TRANSITIONS: Record<AutonomousPipelineState, AutonomousPipelineState[]> = {
  OBSERVING: ['EVENT_DETECTED', 'OPPORTUNITY_IDENTIFIED', 'FAILED', 'CANCELLED'],
  EVENT_DETECTED: ['OPPORTUNITY_IDENTIFIED', 'FAILED', 'CANCELLED'],
  OPPORTUNITY_IDENTIFIED: ['STRATEGY_SELECTED', 'FAILED', 'CANCELLED'],
  STRATEGY_SELECTED: ['RISK_REVIEW', 'FAILED', 'CANCELLED'],
  RISK_REVIEW: ['RISK_REJECTED', 'RISK_APPROVED', 'FAILED', 'CANCELLED'],
  RISK_REJECTED: ['COMPLETED', 'FAILED', 'CANCELLED'],
  RISK_APPROVED: ['LIFECYCLE_CREATED', 'ENTRY_BLOCKED', 'FAILED', 'CANCELLED'],
  LIFECYCLE_CREATED: ['ENTRY_BLOCKED', 'ENTRY_REQUESTED', 'ENTRY_FILLED', 'MONITORING', 'FAILED', 'CANCELLED'],
  ENTRY_BLOCKED: ['ENTRY_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  ENTRY_REQUESTED: ['ENTRY_SUBMITTED', 'ENTRY_FILLED', 'FAILED', 'CANCELLED'],
  ENTRY_SUBMITTED: ['ENTRY_FILLED', 'FAILED', 'CANCELLED'],
  ENTRY_FILLED: ['MONITORING', 'EXIT_RECOMMENDED', 'FAILED', 'CANCELLED'],
  MONITORING: ['EXIT_RECOMMENDED', 'EVALUATING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  EXIT_RECOMMENDED: ['EXIT_REQUESTED', 'FAILED', 'CANCELLED'],
  EXIT_REQUESTED: ['EXIT_FILLED', 'FAILED', 'CANCELLED'],
  EXIT_FILLED: ['EVALUATING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  EVALUATING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: AutonomousPipelineState, to: AutonomousPipelineState): boolean {
  return from === to || VALID_TRANSITIONS[from]?.includes(to) === true;
}

export function buildPipelineTransition(args: {
  from: AutonomousPipelineState;
  to: AutonomousPipelineState;
  actor: string;
  reason: string;
  event?: string;
  reasonCode?: string | null;
  relatedRecords?: AutonomousPipelineRelatedRecord[];
  metadata?: Record<string, unknown>;
  now?: Date;
}): AutonomousPipelineTimelineEvent {
  if (!canTransition(args.from, args.to)) {
    throw new Error(`INVALID_AUTONOMOUS_PIPELINE_TRANSITION:${args.from}->${args.to}`);
  }
  return {
    at: (args.now ?? new Date()).toISOString(),
    state: args.to,
    actor: args.actor,
    event: args.event ?? `Pipeline moved to ${args.to}.`,
    reason: args.reason,
    reasonCode: args.reasonCode ?? null,
    relatedRecords: args.relatedRecords ?? [],
    metadata: args.metadata ?? {},
  };
}

