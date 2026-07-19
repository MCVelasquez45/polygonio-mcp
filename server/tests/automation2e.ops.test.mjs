// Sprint 2E launch — emergency stop end to end (durable flag blocks entries; no
// broker submission), mirroring the /api/automation/emergency-stop behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';
import { FIXTURE_NOW, noResetSessionFields } from './automation2b.fixtures.mjs';
import { baselineChains, currentChains } from './automation2d.fixtures.mjs';

const mods = await loadDist();
const automationSvc = await import('../dist/features/automation/automation.service.js');
const NOW = FIXTURE_NOW;
const NEXT = FIXTURE_NOW + 6 * 60_000;

function guardSubmit(adapter) {
  const original = adapter.submitOrder.bind(adapter);
  let calls = 0;
  adapter.submitOrder = async (...args) => { calls += 1; return original(...args); };
  return () => calls;
}
const chainsFixture = (map, now) => ({ symbols: Object.fromEntries(Object.entries(map).map(([s, c]) => [s, { current: c }])), now, account: { equity: 100_000, buyingPower: 50_000 } });

test('emergency stop blocks entries end to end', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock, submitCalls, session, sessionId;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetAutomationUniverseProviderForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    submitCalls = guardSubmit(mock);
    await mods.initializeAutomation({ adapter: mock });
    session = await createReadySession(mods, { underlying: null, ...noResetSessionFields() });
    sessionId = String(session._id);
    await mods.upsertWatchlistItem({ symbol: 'SPY', enabled: true, automationEnabled: true, priority: 10 });
  });

  // Mirror the endpoint: set the durable emergency-stop flag on runnable sessions.
  const activateEmergencyStop = () =>
    mods.AutomationSessionModel.updateMany(
      { status: { $in: mods.RUNNABLE_SESSION_STATUSES } },
      { $set: { emergencyStop: { active: true, reason: 'test', at: new Date() } } }
    );
  const clearEmergencyStop = () =>
    mods.AutomationSessionModel.updateMany({}, { $set: { emergencyStop: { active: false, reason: null, at: new Date() } } });

  await t.test('active emergency stop → GATES_REJECTED, no intent, no broker submission', async () => {
    await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
    await activateEmergencyStop();
    const result = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }) }, NEXT));
    assert.equal(result.outcomeLabel, 'GATES_REJECTED');
    assert.equal(result.evaluation.reasonCodes.includes('EMERGENCY_STOP_ACTIVE'), true);
    assert.equal(result.orderIntent, null);
    assert.equal(submitCalls(), 0);
  });

  await t.test('emergency stop is durable (survives reload) and clears cleanly', async () => {
    await activateEmergencyStop();
    let reloaded = await mods.AutomationSessionModel.findById(sessionId);
    assert.equal(reloaded.emergencyStop.active, true, 'flag persisted to Mongo');
    await clearEmergencyStop();
    reloaded = await mods.AutomationSessionModel.findById(sessionId);
    assert.equal(reloaded.emergencyStop.active, false);
    // After clearing, a fresh window can produce an intent again.
    await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
    const result = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }) }, NEXT));
    assert.equal(result.outcomeLabel, 'INTENT_CREATED');
  });

  await t.test('session activation: CREATED → READY + reconciliation CLEAN → scheduler evaluates it', async () => {
    const created = await automationSvc.createSession({ strategyVersionId: 'sv-x', underlying: null, universe: [] });
    assert.equal(created.status, 'CREATED');
    const activated = await automationSvc.activateSession(String(created._id));
    assert.equal(activated.status, 'READY');
    assert.equal(activated.reconciliationStatus, 'CLEAN');
    // The evaluation scheduler now finds a READY session and evaluates the watchlist.
    const tick = await mods.runEvaluationTick({
      adapter: mock,
      ownerId: 'owner-A',
      now: NOW,
      evaluate: async (sid) => {
        const r = await mods.processOptionsFlowTick(sid, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
        return { approvedIntentId: null, outcome: r.outcomeLabel };
      },
    });
    assert.ok(tick.sessions.some((s) => s.automationSessionId === String(created._id)), 'the activated session was evaluated');
  });
});
