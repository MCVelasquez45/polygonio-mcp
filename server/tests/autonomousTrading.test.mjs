import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const gate = await import('../dist/features/autonomousTrading/contracts/entryGate.js');
const state = await import('../dist/features/autonomousTrading/state/pipelineStateMachine.js');
const shadow = await import('../dist/features/autonomousTrading/shadow/shadowExecutionAdapter.js');
const contract = await import('../dist/features/autonomousTrading/contracts/pipelineContract.js');
const storage = await import('../dist/features/autonomousTrading/storage/autonomousPipelineJournal.service.js');
const { AutonomousPipelineModel } = await import('../dist/features/autonomousTrading/storage/autonomousPipeline.model.js');

const passingGate = {
  autonomousTradingEnabled: true,
  autonomousEntryEnabled: true,
  mode: 'AUTONOMOUS_PAPER',
  alpacaPaperConfirmed: true,
  marketOpen: true,
  automationReady: true,
  mongoConnected: true,
  brokerTruthCurrent: true,
  executionLeaseOwned: true,
  emergencyStopActive: false,
  riskApprovalExists: true,
  riskApproved: true,
  riskApprovalExpired: false,
  recommendationMatchesApproval: true,
  lifecycleAlreadyExists: false,
  duplicateOrderIntentExists: false,
  positionAndOrderLimitsPermitEntry: true,
};

test('autonomous entry gate fails closed for every required condition', () => {
  assert.equal(gate.evaluateAutonomousEntryGate(passingGate).allowed, true);

  const rejected = gate.evaluateAutonomousEntryGate({
    ...passingGate,
    autonomousEntryEnabled: false,
    marketOpen: false,
    brokerTruthCurrent: false,
    duplicateOrderIntentExists: true,
  });
  assert.equal(rejected.allowed, false);
  assert.deepEqual(rejected.reasonCodes, [
    'AUTONOMOUS_ENTRY_DISABLED',
    'MARKET_NOT_OPEN',
    'BROKER_TRUTH_STALE',
    'DUPLICATE_ORDER_INTENT',
  ]);
  assert.match(rejected.explanation, /Autonomous paper entries are disabled/);
});

test('autonomous state machine validates append-only transitions', () => {
  assert.equal(state.canTransition('OBSERVING', 'EVENT_DETECTED'), true);
  assert.equal(state.canTransition('RISK_REVIEW', 'RISK_REJECTED'), true);
  assert.equal(state.canTransition('RISK_REJECTED', 'ENTRY_REQUESTED'), false);
  assert.throws(
    () =>
      state.buildPipelineTransition({
        from: 'RISK_REJECTED',
        to: 'ENTRY_REQUESTED',
        actor: 'test',
        reason: 'invalid',
      }),
    /INVALID_AUTONOMOUS_PIPELINE_TRANSITION/
  );
});

test('shadow execution simulates fills without broker order identifiers', () => {
  const record = shadow.createShadowExecution({
    pipelineId: 'pipe-1',
    symbol: 'OXY',
    optionContract: 'O:OXY260724C00060000',
    quantity: 1,
    bid: 1,
    ask: 1.2,
    stopPrice: 0.75,
    targetPrice: 1.55,
    slippagePct: 0.05,
    requestedAt: new Date('2026-07-24T14:30:00.000Z'),
  });
  assert.equal(record.source, 'SHADOW_SIMULATION');
  assert.equal(record.status, 'SIMULATED_FILLED');
  assert.equal(record.mid, 1.1);
  assert.equal(record.simulatedFillPrice, 1.16);
  assert.match(record.reason, /No broker order was submitted/);
});

test('autonomous pipeline persistence is idempotent by pipeline id', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());
  await AutonomousPipelineModel.deleteMany({});

  const pipelineId = contract.stablePipelineId({
    mode: 'SHADOW',
    symbol: 'SPY',
    eventIds: ['event-1'],
    scanId: 'scan-1',
    strategyRunId: 'strategy-1',
    recommendationId: 'risk-pkg-1',
  });
  const now = new Date('2026-07-24T14:30:00.000Z').toISOString();
  const record = contract.emptyPipelineRecord({
    pipelineId,
    mode: 'SHADOW',
    symbol: 'SPY',
    optionContract: 'O:SPY260724C00600000',
    idempotencyKey: pipelineId,
    now,
  });
  record.eventContext.eventIds = ['event-1'];
  record.decisionContext.scanId = 'scan-1';
  record.strategyContext.runId = 'strategy-1';
  record.riskContext.approvalId = 'approval-1';
  record.riskContext.approved = false;
  record.riskContext.reasonCodes = ['MAX_SECTOR_EXPOSURE'];
  record.state = 'RISK_REJECTED';

  await storage.upsertAutonomousPipeline(record);
  await storage.upsertAutonomousPipeline({ ...record, plainLanguageStatus: 'Risk rejected due to sector exposure.' });

  const count = await AutonomousPipelineModel.countDocuments({});
  const saved = await storage.getAutonomousPipeline(pipelineId);
  assert.equal(count, 1);
  assert.equal(saved.plainLanguageStatus, 'Risk rejected due to sector exposure.');
  assert.equal(saved.riskContext.approved, false);
});

