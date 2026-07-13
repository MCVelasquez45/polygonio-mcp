// Phase 2A intent/journal tests: idempotency, resubmission safety, and the
// broker-truth-only order journal. (Required tests 3, 4, 5, 6, 7.)
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
  baseIntentInput,
} from './automation.helpers.mjs';

const mods = await loadDist();

test('order intent journal', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
  });

  await t.test('3. duplicate idempotency key creates only one order intent', async () => {
    const session = await createReadySession(mods);
    const input = baseIntentInput(session._id);

    const first = await mods.createOrderIntent(input);
    const second = await mods.createOrderIntent(input);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(String(first.intent._id), String(second.intent._id));
    assert.equal(first.intent.idempotencyKey, second.intent.idempotencyKey);

    const count = await mongoose.connection.db
      .collection('automation_order_intents')
      .countDocuments({ idempotencyKey: first.intent.idempotencyKey });
    assert.equal(count, 1);

    // Different closed bar → different key → distinct intent.
    const third = await mods.createOrderIntent(
      baseIntentInput(session._id, { closedBarTimestamp: '2026-07-10T14:40:00.000Z' })
    );
    assert.equal(third.created, true);
    assert.notEqual(String(third.intent._id), String(first.intent._id));
  });

  await t.test('unique index enforces idempotency at the database level', async () => {
    const indexes = await mods.OrderIntentModel.collection.indexes();
    const keyIndex = indexes.find(index => index.key?.idempotencyKey === 1);
    assert.ok(keyIndex, 'idempotencyKey index must exist');
    assert.equal(keyIndex.unique, true, 'idempotencyKey index must be unique');
  });

  await t.test('4. repeated submission uses the existing intent (one broker order ever)', async () => {
    const session = await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id));

    const firstSubmit = await mods.submitIntent(String(intent._id), mock);
    assert.equal(firstSubmit.outcome, 'SUBMITTED');
    assert.equal(mock.submitCalls, 1);

    const secondSubmit = await mods.submitIntent(String(intent._id), mock);
    assert.equal(secondSubmit.outcome, 'ALREADY_SUBMITTED');
    assert.equal(mock.submitCalls, 1, 'second submission must not create another broker order');
    assert.equal(secondSubmit.brokerOrder.brokerOrderId, firstSubmit.brokerOrder.brokerOrderId);

    // Creating the "same" intent again and submitting also reuses everything.
    const dup = await mods.createOrderIntent(baseIntentInput(session._id));
    assert.equal(dup.created, false);
    const thirdSubmit = await mods.submitIntent(String(dup.intent._id), mock);
    assert.equal(thirdSubmit.outcome, 'ALREADY_SUBMITTED');
    assert.equal(mock.submitCalls, 1);
  });

  await t.test('5. internal events cannot mark a broker order filled', async () => {
    // A Socket.IO-shaped internal payload has no broker identity — rejected.
    await assert.rejects(
      () =>
        mods.recordBrokerOrderSnapshot(
          { event: 'futures:order:filled', symbol: 'SPY', status: 'FILLED' },
          { source: 'order-poll' }
        ),
      (error) => error.code === 'AUTOMATION_ILLEGAL_BROKER_STATE_SOURCE'
    );
    // A broker-shaped payload with a non-broker source is also rejected.
    await assert.rejects(
      () =>
        mods.recordBrokerOrderSnapshot(
          {
            brokerOrderId: 'x-1',
            rawStatus: 'filled',
            status: 'FILLED',
            clientOrderId: null,
            symbol: 'SPY',
            side: 'BUY',
            qty: 1,
            filledQty: 1,
            avgFillPrice: 1,
            orderType: 'limit',
            limitPrice: 1,
            timeInForce: 'day',
            submittedAt: null,
            updatedAt: null,
          },
          { source: 'socket-event' }
        ),
      (error) => error.code === 'AUTOMATION_ILLEGAL_BROKER_STATE_SOURCE'
    );
    const count = await mongoose.connection.db.collection('automation_broker_orders').countDocuments({});
    assert.equal(count, 0, 'no journal rows may exist after rejected writes');
  });

  await t.test('6. broker partial fill is persisted correctly', async () => {
    const session = await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id, { quantity: 4 }));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'partial_fill' });

    const result = await mods.submitIntent(String(intent._id), mock);
    assert.equal(result.outcome, 'SUBMITTED');
    assert.equal(result.brokerOrder.status, 'PARTIALLY_FILLED');

    const journal = await mongoose.connection.db
      .collection('automation_broker_orders')
      .findOne({ brokerOrderId: result.brokerOrder.brokerOrderId });
    assert.equal(journal.status, 'PARTIALLY_FILLED');
    assert.equal(journal.rawStatus, 'partially_filled');
    assert.equal(journal.filledQty, 2);
    assert.equal(journal.lastSource, 'submit-response');
    assert.ok(Array.isArray(journal.statusHistory) && journal.statusHistory.length >= 1);
  });

  await t.test('7. broker rejection is persisted correctly', async () => {
    const session = await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'reject', rejectReason: 'insufficient buying power' });

    const result = await mods.submitIntent(String(intent._id), mock);
    assert.equal(result.outcome, 'BROKER_REJECTED');

    const storedIntent = await mongoose.connection.db
      .collection('automation_order_intents')
      .findOne({ _id: intent._id });
    assert.equal(storedIntent.status, 'BROKER_REJECTED');
    assert.ok(storedIntent.rejectionReason);

    const journal = await mongoose.connection.db
      .collection('automation_broker_orders')
      .findOne({ brokerOrderId: result.brokerOrder.brokerOrderId });
    assert.equal(journal.status, 'REJECTED');
  });

  await t.test('broker timeout leaves the intent ambiguous — never blind-retried', async () => {
    const session = await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'timeout' });

    const result = await mods.submitIntent(String(intent._id), mock);
    assert.equal(result.outcome, 'AMBIGUOUS_SUBMIT_FAILURE');

    const storedIntent = await mongoose.connection.db
      .collection('automation_order_intents')
      .findOne({ _id: intent._id });
    assert.equal(storedIntent.status, 'SUBMITTING', 'ambiguous submit parks for reconciliation');
    assert.equal(storedIntent.attemptCount, 1);
  });
});
