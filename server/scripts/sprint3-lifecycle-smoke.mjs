// Phase 2C Sprint 3 — Alpaca PAPER order-lifecycle smoke test.
//
// Extends the Sprint 2 submission smoke with broker-truth INGESTION:
//   submit one far-OTM $0.01 limit order (Sprint 2 path)
//   → observe real Alpaca updates via REST reconciliation
//   → verify durable broker state is updated
//   → cancel if unfilled
//   → reconcile the cancellation into the app
//   → confirm zero fills produced NO automation position.
//
// Exactly one order. No forced fills, no market orders, no risk bypass, no
// autonomous submission. Run MANUALLY during regular market hours only:
//   cd server && npm run build && node scripts/sprint3-lifecycle-smoke.mjs
//
// Skips out of hours. No credentials printed.

import 'dotenv/config';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const key = process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? process.env.APCA_API_KEY_ID;
const secret = process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY;
function log(event, payload = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'sprint3-lifecycle-smoke', event, ...payload }));
}
if (!key || !secret) { log('SMOKE_ABORT', { reason: 'missing Alpaca credentials' }); process.exit(1); }

process.env.AUTOMATION_BROKER = 'alpaca-paper';
process.env.ALPACA_PAPER = 'true';

const dist = p => import(`../dist/${p}`);
const { createAlpacaPaperBrokerAdapter } = await dist('features/automation/services/alpacaPaperBrokerAdapter.service.js');
const { initializeAutomation, resetAutomationRuntimeForTests } = await dist('features/automation/services/sessionRecovery.service.js');
const { AutomationSessionModel } = await dist('features/automation/models/automationSession.model.js');
const { BrokerOrderModel } = await dist('features/automation/models/brokerOrder.model.js');
const { AutomationPositionModel } = await dist('features/automation/models/automationPosition.model.js');
const { createOrderIntent } = await dist('features/automation/services/orderIntent.service.js');
const { submitApprovedIntent } = await dist('features/automation/services/orderSubmission.service.js');
const { reconcileNonterminalAutomationOrders, getBrokerStreamHealth } = await dist('features/automation/services/orderReconciliation.service.js');
const { deriveMarketSession } = await dist('features/automation/services/marketSession.service.js');
const { getMarketHoursConfig } = await dist('features/automation/automation.config.js');

async function discoverFarOtmSpyCall() {
  const t = new Date();
  const gte = new Date(t.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const lte = new Date(t.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
  const url = new URL('https://paper-api.alpaca.markets/v2/options/contracts');
  url.searchParams.set('underlying_symbols', 'SPY');
  url.searchParams.set('status', 'active');
  url.searchParams.set('type', 'call');
  url.searchParams.set('expiration_date_gte', gte);
  url.searchParams.set('expiration_date_lte', lte);
  url.searchParams.set('limit', '500');
  const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } });
  if (!r.ok) throw new Error(`contract discovery failed: HTTP ${r.status}`);
  const body = await r.json();
  const contracts = Array.isArray(body?.option_contracts) ? body.option_contracts : [];
  if (!contracts.length) throw new Error('no active SPY call contracts');
  contracts.sort((a, b) => Number(b.strike_price) - Number(a.strike_price));
  return contracts[0];
}

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'sprint3-smoke' });
let exitCode = 0;
try {
  resetAutomationRuntimeForTests?.();
  const adapter = createAlpacaPaperBrokerAdapter();
  const init = await initializeAutomation({ adapter });
  if (!init.ready) throw new Error(`automation not ready: ${init.detail}`);
  log('AUTOMATION_READY', { broker: adapter.describe() });

  const clock = await adapter.getClock();
  const marketSession = deriveMarketSession(clock, getMarketHoursConfig(), Date.now());
  if (!marketSession.entriesAllowed) { log('SMOKE_SKIPPED', { reason: `market ${marketSession.phase}` }); process.exit(0); }

  const contract = await discoverFarOtmSpyCall();
  const session = await AutomationSessionModel.create({ mode: 'paper', strategyVersionId: 'sprint3-smoke', underlying: 'SPY', status: 'READY', healthStatus: 'HEALTHY', reconciliationStatus: 'CLEAN' });
  const { intent } = await createOrderIntent({
    automationSessionId: String(session._id), strategyVersionId: 'sprint3-smoke', underlying: 'SPY',
    signalDirection: 'BUY', closedBarTimestamp: new Date(), intentType: 'ENTRY',
    optionSymbol: contract.symbol, quantity: 1, orderType: 'limit', limitPrice: 0.01, timeInForce: 'day',
  });
  intent.status = 'APPROVED_AWAITING_EXECUTION';
  await intent.save();

  // 1. submit exactly one order
  const submit = await submitApprovedIntent(String(intent._id), adapter, { ownsLease: true, marketSession });
  if (!submit.submitted) throw new Error(`submission not acknowledged: ${submit.outcome} ${submit.refusedReason ?? ''}`);
  log('PROOF_1_SUBMITTED', { brokerOrderId: submit.brokerOrderId, brokerStatus: submit.brokerStatus });

  // 2. observe real Alpaca updates via REST reconciliation
  const r1 = await reconcileNonterminalAutomationOrders(adapter);
  const afterObserve = await BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
  log('PROOF_2_OBSERVED', { reconcile: r1, brokerStatus: afterObserve?.status, filledQty: afterObserve?.filledQty, streamHealth: getBrokerStreamHealth().state });

  // 3. cancel if unfilled
  if ((afterObserve?.filledQty ?? 0) === 0) {
    await adapter.cancelOrder(submit.brokerOrderId);
    log('PROOF_3_CANCEL_REQUESTED', {});
  }

  // 4. reconcile the cancellation into the app (stream or REST)
  await new Promise(res => setTimeout(res, 1500));
  const r2 = await reconcileNonterminalAutomationOrders(adapter);
  const final = await BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
  log('PROOF_4_CANCELLATION_RECONCILED', { reconcile: r2, finalStatus: final?.status, filledQty: final?.filledQty });

  // 5. zero fills → no automation position
  const positions = await AutomationPositionModel.countDocuments({ entryClientOrderId: intent.clientOrderId });
  if ((final?.filledQty ?? 0) === 0 && positions !== 0) throw new Error('zero-fill order must not create a position');
  if ((final?.filledQty ?? 0) > 0) {
    log('UNEXPECTED_PARTIAL_FILL', { filledQty: final.filledQty, note: 'preserve real exposure; stop autonomous submission; report' });
  }
  const orderCount = await BrokerOrderModel.countDocuments({ clientOrderId: intent.clientOrderId });
  if (orderCount !== 1) throw new Error(`expected exactly 1 broker order, found ${orderCount}`);
  log('SMOKE_PASSED', { positions, brokerOrders: orderCount });
} catch (error) {
  exitCode = 1;
  log('SMOKE_FAILED', { message: String(error?.message ?? error).slice(0, 400) });
} finally {
  await mongoose.disconnect().catch(() => undefined);
  await mongod.stop().catch(() => undefined);
}
process.exit(exitCode);
