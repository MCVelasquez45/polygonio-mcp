// Phase 2C Sprint 3 — broker updates, fills, durable positions.
// Only Alpaca broker truth creates fills/positions; every update is monotonic,
// idempotent, and out-of-order safe. STOPS at position create/update — no
// exits, P&L, or risk counters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';

const mods = await loadDist();

// Build a BrokerOrder payload (broker-truth shape) for an intent.
function brokerOrder(intent, over = {}) {
  return {
    brokerOrderId: over.brokerOrderId ?? 'bo-1',
    clientOrderId: intent.clientOrderId,
    symbol: intent.optionSymbol ?? 'SPY260724C00500000',
    side: 'BUY',
    qty: over.qty ?? 2,
    filledQty: over.filledQty ?? 0,
    avgFillPrice: over.avgFillPrice ?? null,
    status: over.status ?? 'ACCEPTED',
    rawStatus: over.rawStatus ?? (over.status ?? 'accepted').toLowerCase(),
    orderType: 'limit',
    limitPrice: 1.15,
    timeInForce: 'day',
    submittedAt: new Date('2026-07-10T15:00:00.000Z'),
    updatedAt: over.updatedAt ?? new Date('2026-07-10T15:01:00.000Z'),
  };
}

async function approvedSubmittedIntent(mods, sessionId, over = {}) {
  const { intent } = await mods.createOrderIntent({
    automationSessionId: sessionId, strategyVersionId: 'sv-test-1', underlying: 'SPY',
    signalDirection: 'BUY', closedBarTimestamp: new Date('2026-07-10T15:00:00.000Z'),
    intentType: 'ENTRY', optionSymbol: over.optionSymbol ?? 'SPY260724C00500000',
    quantity: 2, orderType: 'limit', limitPrice: 1.15, timeInForce: 'day',
  });
  intent.status = 'SUBMITTED';
  await intent.save();
  return intent;
}

test('broker-update ingestion (Sprint 3)', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetBrokerStreamHealthForTests?.();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    await mods.initializeAutomation({ adapter: mock });
    session = await createReadySession(mods, { underlying: 'SPY', reconciliationStatus: 'CLEAN' });
  });

  // ---- classification (pure) ----------------------------------------------
  await t.test('classifyBrokerTransition: fresh/duplicate/stale/contradiction', () => {
    const c = mods.classifyBrokerTransition;
    assert.equal(c(null, { status: 'ACCEPTED', filledQty: 0 }), 'FRESH');
    assert.equal(c({ status: 'ACCEPTED', filledQty: 0 }, { status: 'ACCEPTED', filledQty: 0 }), 'DUPLICATE');
    assert.equal(c({ status: 'PARTIALLY_FILLED', filledQty: 2 }, { status: 'PARTIALLY_FILLED', filledQty: 1 }), 'STALE');
    assert.equal(c({ status: 'FILLED', filledQty: 2 }, { status: 'PARTIALLY_FILLED', filledQty: 2 }), 'STALE');
    assert.equal(c({ status: 'FILLED', filledQty: 2 }, { status: 'REJECTED', filledQty: 0 }), 'CONTRADICTION');
    assert.equal(c({ status: 'REPLACED', filledQty: 0 }, { status: 'FILLED', filledQty: 2 }), 'FRESH');
  });

  // 1,2. accepted / pending-new persist, no position
  await t.test('1-2. accepted + pending-new persist; no position (no confirmed fill)', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'PENDING_NEW', rawStatus: 'pending_new' }), 'stream');
    let bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'PENDING_NEW');
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'ACCEPTED' }), 'stream');
    bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'ACCEPTED');
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
  });

  // 3,4,6. first partial → one position; additional fill → same position; full fill
  await t.test('3-4-6. partial fill creates position; more fill updates it; full fill', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    const r1 = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'PARTIALLY_FILLED', rawStatus: 'partially_filled', filledQty: 1, avgFillPrice: 1.0 }), 'stream');
    assert.ok(r1.positionId);
    let pos = await mods.AutomationPositionModel.findById(r1.positionId);
    assert.equal(pos.status, 'OPEN');
    assert.equal(pos.filledQty, 1);
    assert.equal(pos.orderedQuantity, 2);

    const r2 = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'PARTIALLY_FILLED', rawStatus: 'partially_filled', filledQty: 2, avgFillPrice: 1.05 }), 'stream');
    assert.equal(r2.positionId, r1.positionId, 'same position');
    pos = await mods.AutomationPositionModel.findById(r1.positionId);
    assert.equal(pos.filledQty, 2);

    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.05 }), 'stream');
    const bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'FILLED');
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 1);
  });

  // 5. weighted average entry from broker truth (Alpaca's authoritative avg)
  await t.test('5. average entry price is Alpaca broker truth, not recomputed', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    // Broker reports its authoritative weighted avg fill price on the full fill.
    const r = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.2345 }), 'stream');
    const pos = await mods.AutomationPositionModel.findById(r.positionId);
    assert.equal(pos.avgEntryPrice, 1.2345);
    // Contract count stored as-is (not ×100).
    assert.equal(pos.filledQty, 2);
  });

  // 7,18. duplicate/replayed fill does not double-count
  await t.test('7-18. duplicate/replayed FILLED does not double-count or duplicate position', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    const order = brokerOrder(intent, { status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.0 });
    const r1 = await mods.ingestBrokerOrderUpdate(order, 'stream');
    const r2 = await mods.ingestBrokerOrderUpdate(order, 'stream'); // replay
    assert.equal(r2.transition, 'DUPLICATE');
    const pos = await mods.AutomationPositionModel.findById(r1.positionId);
    assert.equal(pos.filledQty, 2);
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 1);
  });

  // 9,10. out-of-order lower fill / FILLED cannot regress
  await t.test('9-10. stale lower-fill and FILLED→PARTIALLY_FILLED cannot regress', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    const r = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.0 }), 'stream');
    const stale = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'PARTIALLY_FILLED', rawStatus: 'partially_filled', filledQty: 1, avgFillPrice: 0.5 }), 'stream');
    assert.equal(stale.transition, 'STALE');
    const bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'FILLED');
    assert.equal(bo.filledQty, 2);
    const pos = await mods.AutomationPositionModel.findById(r.positionId);
    assert.equal(pos.filledQty, 2);
  });

  // 11,13,15. zero-fill cancel/expired/rejected create no position
  await t.test('11-13-15. zero-fill CANCELLED/EXPIRED/REJECTED create no position', async () => {
    const cases = [['CANCELLED', 'canceled', 'FAILED'], ['EXPIRED', 'expired', 'FAILED'], ['REJECTED', 'rejected', 'BROKER_REJECTED']];
    let i = 0;
    for (const [status, raw, expectIntent] of cases) {
      i += 1;
      // Distinct closedBarTimestamp → distinct idempotency key → distinct intent.
      const { intent } = await mods.createOrderIntent({
        automationSessionId: String(session._id), strategyVersionId: 'sv-test-1', underlying: 'SPY',
        signalDirection: 'BUY', closedBarTimestamp: new Date(Date.parse('2026-07-10T15:00:00.000Z') + i * 60_000),
        intentType: 'ENTRY', optionSymbol: 'SPY260724C00500000', quantity: 2, orderType: 'limit', limitPrice: 1.15, timeInForce: 'day',
      });
      intent.status = 'SUBMITTED';
      await intent.save();
      await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { brokerOrderId: `bo-${status}`, status, rawStatus: raw, filledQty: 0 }), 'stream');
      const saved = await mods.OrderIntentModel.findById(intent._id);
      assert.equal(saved.status, expectIntent, `${status} → intent ${expectIntent}`);
    }
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
  });

  // 12,14. partial-fill then cancel/expired retains the real position
  await t.test('12-14. partial fill then CANCELLED/EXPIRED retains position with confirmed qty', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    const r = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'PARTIALLY_FILLED', rawStatus: 'partially_filled', filledQty: 1, avgFillPrice: 1.0 }), 'stream');
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'CANCELLED', rawStatus: 'canceled', filledQty: 1, avgFillPrice: 1.0 }), 'stream');
    const pos = await mods.AutomationPositionModel.findById(r.positionId);
    assert.equal(pos.status, 'OPEN');
    assert.equal(pos.filledQty, 1, 'real partial exposure preserved');
    const bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'CANCELLED');
  });

  // 16,17. replaced-order lineage → one intent, one position
  await t.test('16-17. replacement lineage keeps one intent and one position', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { brokerOrderId: 'bo-orig', status: 'REPLACED', rawStatus: 'replaced', filledQty: 0 }), 'stream');
    // Replacement order: new broker id, same client_order_id, fills.
    const r = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { brokerOrderId: 'bo-replacement', status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.1 }), 'stream');
    assert.equal(r.transition, 'FRESH');
    assert.ok(r.positionId);
    // Original broker record preserved + replacement recorded.
    assert.ok(await mods.BrokerOrderModel.findOne({ brokerOrderId: 'bo-orig' }));
    assert.ok(await mods.BrokerOrderModel.findOne({ brokerOrderId: 'bo-replacement' }));
    assert.equal(await mods.AutomationPositionModel.countDocuments({ entryIntentId: String(intent._id) }), 1);
  });

  // 22. contradictory terminal → MANUAL_REVIEW
  await t.test('22. contradictory terminal states → MANUAL_REVIEW', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.0 }), 'stream');
    const c = await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'REJECTED', rawStatus: 'rejected', filledQty: 0 }), 'reconciliation');
    assert.equal(c.transition, 'CONTRADICTION');
    assert.equal(c.manualReview, true);
    const bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'MANUAL_REVIEW');
    const saved = await mods.OrderIntentModel.findById(intent._id);
    assert.equal(saved.status, 'MANUAL_REVIEW');
  });

  // 25,29,30. ownership never guessed; no synthetic fills; no position without broker fill
  await t.test('25. an order with no matching automation intent is never claimed', async () => {
    const res = await mods.ingestBrokerOrderUpdate({
      brokerOrderId: 'manual-1', clientOrderId: 'not-ours', symbol: 'AAPL260724C00200000', side: 'BUY',
      qty: 1, filledQty: 1, avgFillPrice: 2, status: 'FILLED', rawStatus: 'filled', orderType: 'limit',
      limitPrice: 2, timeInForce: 'day', submittedAt: new Date(), updatedAt: new Date(),
    }, 'stream');
    assert.equal(res.transition, 'IGNORED_NO_INTENT');
    assert.equal(res.positionId, null);
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
  });

  await t.test('29. internal payloads cannot synthesize a fill (broker-identity required)', async () => {
    await assert.rejects(() => mods.recordBrokerOrderSnapshot({ status: 'FILLED', filledQty: 1 }, { source: 'stream' }), /broker|source/i);
  });

  await t.test('30. no position is created without broker-confirmed filled quantity', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'ACCEPTED', filledQty: 0 }), 'stream');
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
  });
});

// ---- reconciliation worker + startup + stream health -----------------------
test('order reconciliation + stream health (Sprint 3)', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetBrokerStreamHealthForTests?.();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    await mods.initializeAutomation({ adapter: mock });
    session = await createReadySession(mods, { underlying: 'SPY', reconciliationStatus: 'CLEAN' });
  });

  // 19,20,21. REST reconciliation repairs a missed update / restores a position
  await t.test('19-20-21. REST reconciliation repairs a missed fill into a position', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    // Persist a nonterminal ACCEPTED broker order (stream missed the later fill).
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { brokerOrderId: 'bo-x', status: 'ACCEPTED', filledQty: 0 }), 'stream');
    // Broker truth: the order actually FILLED. getOrder('bo-x') returns that.
    mock.seedUnknownOrder({
      symbol: 'SPY260724C00500000', clientOrderId: intent.clientOrderId, brokerOrderId: 'bo-x',
      qty: 2, filledQty: 2, avgFillPrice: 1.0, status: 'FILLED', rawStatus: 'filled',
    });
    const summary = await mods.reconcileNonterminalAutomationOrders(mock);
    assert.ok(summary.scanned >= 1);
    const pos = await mods.AutomationPositionModel.findOne({ entryIntentId: String(intent._id) });
    assert.ok(pos, 'position restored by REST reconciliation');
    assert.equal(pos.filledQty, 2);
  });

  // 26. stream disconnect → REST keeps truth current
  await t.test('26. stream disconnect falls back to REST reconciliation for truth', async () => {
    mods.markStreamState('DISCONNECTED');
    await mods.reconcileNonterminalAutomationOrders(mock);
    const health = mods.getBrokerStreamHealth();
    assert.equal(health.state, 'DISCONNECTED');
    assert.equal(health.truthCurrent, true, 'REST reconciliation keeps truth current');
  });

  // 27. broker truth stale blocks new submission
  await t.test('27. stale broker truth blocks a new submission', async () => {
    mods.resetBrokerStreamHealthForTests(); // no reconciliation yet, disconnected
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    intent.status = 'APPROVED_AWAITING_EXECUTION';
    await intent.save();
    const res = await mods.submitApprovedIntent(String(intent._id), mock, {
      ownsLease: true,
      marketSession: { isOpen: true, entriesAllowed: true, phase: 'PRE_CUTOFF' },
    });
    assert.equal(res.outcome, 'REFUSED');
    assert.equal(res.refusedReason, 'BROKER_TRUTH_STALE');
  });

  // 28. reconciliation runs outside market hours without submitting
  await t.test('28. reconciliation runs when market closed and submits nothing', async () => {
    mock.setClock('closed');
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { brokerOrderId: 'bo-c', status: 'ACCEPTED', filledQty: 0 }), 'stream');
    const guard = (() => { let c = 0; const o = mock.submitOrder.bind(mock); mock.submitOrder = async (...a) => { c += 1; return o(...a); }; return () => c; })();
    const summary = await mods.reconcileNonterminalAutomationOrders(mock);
    assert.ok(summary.scanned >= 0);
    assert.equal(guard(), 0, 'reconciliation never submits');
  });

  // 23,24. portfolio ownership classification (real Mongo + broker truth)
  await t.test('23-24. portfolio classifies automation vs manual by proven linkage', async () => {
    const intent = await approvedSubmittedIntent(mods, String(session._id));
    await mods.ingestBrokerOrderUpdate(brokerOrder(intent, { status: 'FILLED', rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.0 }), 'stream');
    // Broker truth reports the filled position (as Alpaca would after a fill).
    mock.seedPosition({ symbol: 'SPY260724C00500000', qty: 2, side: 'long', avgEntryPrice: 1.0 });
    mock.seedPosition({ symbol: 'AAPL260724C00200000', qty: 1, side: 'long', avgEntryPrice: 2 });
    const ops = await mods.getPortfolioOperations();
    const bySymbol = new Map(ops.automationContext.positionsBySymbol.map(p => [p.symbol, p]));
    assert.equal(bySymbol.get('SPY260724C00500000')?.source, 'AUTOMATION');
    assert.equal(bySymbol.get('AAPL260724C00200000')?.source, 'MANUAL');
    assert.ok(ops.brokerStreamHealth, 'broker-stream health surfaced');
  });
});
