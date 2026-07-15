// Execution-boundary repair — the manual execution gateway must fail closed,
// and a manual paper order must require an explicit confirmed durable intent and
// submit exactly once (idempotent). Automation is rejected from the manual path.
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const gateway = await import('../dist/features/broker/executionGateway.js');
const svc = await import('../dist/features/broker/manualTrading.service.js');
const { ManualOrderIntentModel } = await import('../dist/features/broker/manualOrderIntent.model.js');

const { authorizeManualSubmission, manualClientOrderId, GATE_REASON } = gateway;

const baseGate = (overrides = {}) => ({
  executionMode: 'MANUAL',
  orderSource: 'MANUAL_UI',
  authorizationId: 'intent-1',
  idempotencyKey: 'manual-abc',
  confirmed: true,
  payloadUnchanged: true,
  gates: { manualTradingEnabled: true, mongoConnected: true, clockAvailable: true },
  ...overrides,
});

test('execution gateway (pure) fails closed', async (t) => {
  await t.test('a fully-authorized manual submission passes', () => {
    const r = authorizeManualSubmission(baseGate());
    assert.equal(r.authorized, true);
    assert.equal(r.rejectionReason, null);
  });

  const cases = [
    ['missing mode', { executionMode: '' }, GATE_REASON.MISSING_EXECUTION_MODE],
    ['invalid mode', { executionMode: 'FOO' }, GATE_REASON.INVALID_EXECUTION_MODE],
    ['automated mode rejected on manual path', { executionMode: 'AUTOMATED' }, GATE_REASON.AUTOMATION_MUST_USE_ENGINE_PATH],
    ['automation source rejected on manual path', { orderSource: 'AUTOMATION_ENGINE' }, GATE_REASON.AUTOMATION_MUST_USE_ENGINE_PATH],
    ['missing source', { orderSource: '' }, GATE_REASON.MISSING_ORDER_SOURCE],
    ['invalid source', { orderSource: 'WAT' }, GATE_REASON.INVALID_ORDER_SOURCE],
    ['missing authorization', { authorizationId: null }, GATE_REASON.MISSING_AUTHORIZATION_ID],
    ['missing idempotency key', { idempotencyKey: null }, GATE_REASON.MISSING_IDEMPOTENCY_KEY],
    ['not confirmed', { confirmed: false }, GATE_REASON.MANUAL_INTENT_NOT_CONFIRMED],
    ['payload changed', { payloadUnchanged: false }, GATE_REASON.PAYLOAD_CHANGED_SINCE_CONFIRMATION],
    ['manual trading disabled', { gates: { manualTradingEnabled: false, mongoConnected: true, clockAvailable: true } }, GATE_REASON.MANUAL_TRADING_DISABLED],
    ['mongo unavailable', { gates: { manualTradingEnabled: true, mongoConnected: false, clockAvailable: true } }, GATE_REASON.MONGO_UNAVAILABLE],
    ['clock unavailable', { gates: { manualTradingEnabled: true, mongoConnected: true, clockAvailable: false } }, GATE_REASON.MARKET_CLOCK_UNAVAILABLE],
  ];
  for (const [name, override, expected] of cases) {
    await t.test(`rejects: ${name}`, () => {
      const r = authorizeManualSubmission(baseGate(override));
      assert.equal(r.authorized, false);
      assert.equal(r.rejectionReason, expected);
    });
  }

  await t.test('manual client_order_id is deterministic, prefixed, collision-free', () => {
    const a1 = manualClientOrderId('intentA', 1);
    const a1b = manualClientOrderId('intentA', 1);
    const a2 = manualClientOrderId('intentA', 2);
    const b1 = manualClientOrderId('intentB', 1);
    assert.equal(a1, a1b, 'same intent+attempt → same id');
    assert.ok(a1.startsWith('manual-'));
    assert.notEqual(a1, a2, 'different attempt → different id');
    assert.notEqual(a1, b1, 'different intent → different id');
    assert.ok(a1.length <= 48, 'within Alpaca length limit');
  });
});

test('manual order lifecycle (durable, gateway-governed, idempotent)', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  const goodGates = { manualTradingEnabled: true, mongoConnected: true, clockAvailable: true };
  const makeBroker = () => {
    let calls = 0;
    const brokerSubmit = async (order) => {
      calls += 1;
      return { id: `broker-${calls}`, client_order_id: order.client_order_id };
    };
    return { brokerSubmit, calls: () => calls };
  };
  const input = () => ({ optionSymbol: 'SPY260724C00500000', side: 'buy', quantity: 1, orderType: 'limit', limitPrice: 1.23 });

  t.beforeEach(async () => {
    await ManualOrderIntentModel.deleteMany({});
  });

  await t.test('create → CREATED, no submission', async () => {
    const intent = await svc.createManualIntent(input());
    assert.equal(intent.status, 'CREATED');
    assert.ok(intent.payloadHash);
    assert.equal(intent.brokerOrderId, null);
  });

  await t.test('submit before confirm is rejected (no broker call)', async () => {
    const intent = await svc.createManualIntent(input());
    const broker = makeBroker();
    const r = await svc.submitManualIntent(String(intent._id), { gates: goodGates, brokerSubmit: broker.brokerSubmit });
    assert.equal(r.outcome, 'REJECTED');
    assert.equal(r.rejectionReason, 'MANUAL_INTENT_NOT_CONFIRMED');
    assert.equal(broker.calls(), 0);
  });

  await t.test('confirm → submit places exactly one broker order with manual- id', async () => {
    const intent = await svc.createManualIntent(input());
    await svc.confirmManualIntent(String(intent._id));
    const broker = makeBroker();
    const r = await svc.submitManualIntent(String(intent._id), { gates: goodGates, brokerSubmit: broker.brokerSubmit });
    assert.equal(r.outcome, 'SUBMITTED');
    assert.equal(broker.calls(), 1);
    assert.ok(r.intent.clientOrderId.startsWith('manual-'));
    assert.ok(r.intent.brokerOrderId);
  });

  await t.test('re-submitting a submitted intent does not duplicate the order', async () => {
    const intent = await svc.createManualIntent(input());
    await svc.confirmManualIntent(String(intent._id));
    const broker = makeBroker();
    await svc.submitManualIntent(String(intent._id), { gates: goodGates, brokerSubmit: broker.brokerSubmit });
    const again = await svc.submitManualIntent(String(intent._id), { gates: goodGates, brokerSubmit: broker.brokerSubmit });
    assert.equal(again.outcome, 'ALREADY_SUBMITTED');
    assert.equal(broker.calls(), 1, 'no second broker submission');
  });

  await t.test('concurrent double-click yields exactly one broker order', async () => {
    const intent = await svc.createManualIntent(input());
    await svc.confirmManualIntent(String(intent._id));
    const broker = makeBroker();
    const [a, b] = await Promise.all([
      svc.submitManualIntent(String(intent._id), { gates: goodGates, brokerSubmit: broker.brokerSubmit }),
      svc.submitManualIntent(String(intent._id), { gates: goodGates, brokerSubmit: broker.brokerSubmit }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ['ALREADY_SUBMITTED', 'SUBMITTED']);
    assert.equal(broker.calls(), 1);
  });

  await t.test('changed payload after confirmation is rejected', async () => {
    const intent = await svc.createManualIntent(input());
    await svc.confirmManualIntent(String(intent._id));
    const broker = makeBroker();
    const r = await svc.submitManualIntent(String(intent._id), {
      gates: goodGates,
      brokerSubmit: broker.brokerSubmit,
      submittedPayloadHash: 'a-different-hash',
    });
    assert.equal(r.outcome, 'REJECTED');
    assert.equal(r.rejectionReason, 'PAYLOAD_CHANGED_SINCE_CONFIRMATION');
    assert.equal(broker.calls(), 0);
  });

  await t.test('infra gate failure blocks submission (fail closed)', async () => {
    const intent = await svc.createManualIntent(input());
    await svc.confirmManualIntent(String(intent._id));
    const broker = makeBroker();
    const r = await svc.submitManualIntent(String(intent._id), {
      gates: { manualTradingEnabled: true, mongoConnected: true, clockAvailable: false },
      brokerSubmit: broker.brokerSubmit,
    });
    assert.equal(r.outcome, 'REJECTED');
    assert.equal(r.rejectionReason, 'MARKET_CLOCK_UNAVAILABLE');
    assert.equal(broker.calls(), 0);
  });
});
