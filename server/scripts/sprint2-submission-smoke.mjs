// Phase 2C Sprint 2 — Alpaca PAPER submission smoke test.
//
// Proves the ACTUAL Sprint 2 wiring end to end (not the adapter in isolation):
//   approved ENTRY intent → submitApprovedIntent() → submitIntent()
//   → PaperBrokerAdapter → Alpaca paper → broker acknowledgement
//   → persisted in the broker-order journal → retrieve by client_order_id
//   → cancel if unfilled → verify persistence → STOP.
//
// Creates EXACTLY ONE paper order. No fills processing, no positions, no P&L.
//
// Run MANUALLY, during regular market hours only:
//   cd server && npm run build && node scripts/sprint2-submission-smoke.mjs
//
// Safety: far-OTM SPY call at a $0.01 day limit (cannot realistically fill);
// the adapter's live-config guard runs first; the submission gates enforce
// market-open/lease/reconciliation. If the market is CLOSED the script SKIPS
// (it never submits out of hours). No credentials are printed.

import 'dotenv/config';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const key = process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? process.env.APCA_API_KEY_ID;
const secret = process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY;

function log(event, payload = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'sprint2-submission-smoke', event, ...payload }));
}

if (!key || !secret) {
  log('SMOKE_ABORT', { reason: 'missing Alpaca credentials' });
  process.exit(1);
}

// Force the real Alpaca paper adapter + submission on, in a throwaway DB.
process.env.AUTOMATION_BROKER = 'alpaca-paper';
process.env.ALPACA_PAPER = 'true';

const dist = p => import(`../dist/${p}`);
const { createAlpacaPaperBrokerAdapter } = await dist('features/automation/services/alpacaPaperBrokerAdapter.service.js');
const { initializeAutomation, resetAutomationRuntimeForTests } = await dist('features/automation/services/sessionRecovery.service.js');
const { AutomationSessionModel } = await dist('features/automation/models/automationSession.model.js');
const { OrderIntentModel } = await dist('features/automation/models/orderIntent.model.js');
const { BrokerOrderModel } = await dist('features/automation/models/brokerOrder.model.js');
const { createOrderIntent } = await dist('features/automation/services/orderIntent.service.js');
const { submitApprovedIntent } = await dist('features/automation/services/orderSubmission.service.js');
const { deriveMarketSession } = await dist('features/automation/services/marketSession.service.js');
const { getMarketHoursConfig } = await dist('features/automation/automation.config.js');

async function discoverFarOtmSpyCall() {
  const today = new Date();
  const gte = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const lte = new Date(today.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
  const url = new URL('https://paper-api.alpaca.markets/v2/options/contracts');
  url.searchParams.set('underlying_symbols', 'SPY');
  url.searchParams.set('status', 'active');
  url.searchParams.set('type', 'call');
  url.searchParams.set('expiration_date_gte', gte);
  url.searchParams.set('expiration_date_lte', lte);
  url.searchParams.set('limit', '500');
  const response = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } });
  if (!response.ok) throw new Error(`contract discovery failed: HTTP ${response.status}`);
  const body = await response.json();
  const contracts = Array.isArray(body?.option_contracts) ? body.option_contracts : [];
  if (!contracts.length) throw new Error('no active SPY call contracts found');
  contracts.sort((a, b) => Number(b.strike_price) - Number(a.strike_price));
  return contracts[0]; // highest strike = far OTM
}

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'sprint2-smoke' });

let exitCode = 0;
try {
  resetAutomationRuntimeForTests?.();
  const adapter = createAlpacaPaperBrokerAdapter(); // live-config guard runs here
  const init = await initializeAutomation({ adapter }); // runs startup reconciliation
  if (!init.ready) throw new Error(`automation not ready: ${init.detail}`);
  log('AUTOMATION_READY', { broker: adapter.describe() });

  const clock = await adapter.getClock();
  const marketSession = deriveMarketSession(clock, getMarketHoursConfig(), Date.now());
  log('MARKET_SESSION', { phase: marketSession.phase, entriesAllowed: marketSession.entriesAllowed });
  if (!marketSession.entriesAllowed) {
    log('SMOKE_SKIPPED', { reason: `market phase ${marketSession.phase} — no submission out of hours` });
    process.exit(0);
  }

  const contract = await discoverFarOtmSpyCall();
  log('CONTRACT_SELECTED', { symbol: contract.symbol, strike: contract.strike_price, expiration: contract.expiration_date });

  const session = await AutomationSessionModel.create({
    mode: 'paper', strategyVersionId: 'sprint2-smoke', underlying: 'SPY',
    status: 'READY', healthStatus: 'HEALTHY', reconciliationStatus: 'CLEAN',
  });

  const { intent } = await createOrderIntent({
    automationSessionId: String(session._id), strategyVersionId: 'sprint2-smoke', underlying: 'SPY',
    signalDirection: 'BUY', closedBarTimestamp: new Date(), intentType: 'ENTRY',
    optionSymbol: contract.symbol, quantity: 1, orderType: 'limit', limitPrice: 0.01, timeInForce: 'day',
  });
  intent.status = 'APPROVED_AWAITING_EXECUTION';
  await intent.save();
  log('APPROVED_INTENT', { intentId: String(intent._id), clientOrderId: intent.clientOrderId });

  // 1. submit exactly one order through the Sprint 2 path
  const result = await submitApprovedIntent(String(intent._id), adapter, { ownsLease: true, marketSession });
  log('PROOF_1_SUBMITTED', { outcome: result.outcome, brokerOrderId: result.brokerOrderId, brokerStatus: result.brokerStatus });
  if (!result.submitted || !result.brokerOrderId) throw new Error(`submission did not acknowledge: ${result.outcome} ${result.refusedReason ?? ''}`);

  // 2. broker acknowledgement is durably persisted
  const journaled = await BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
  if (!journaled) throw new Error('broker acknowledgement not persisted in the journal');
  log('PROOF_2_PERSISTED', {
    brokerOrderId: journaled.brokerOrderId, clientOrderId: journaled.clientOrderId,
    symbol: journaled.symbol, qty: journaled.qty, limitPrice: journaled.limitPrice,
    status: journaled.status, intentId: journaled.intentId, submittedAt: journaled.submittedAt,
  });

  // 3. retrieve by client_order_id (broker truth)
  const fetched = await adapter.getOrderByClientOrderId(intent.clientOrderId);
  if (!fetched || fetched.brokerOrderId !== result.brokerOrderId) throw new Error('retrieval by client_order_id mismatch');
  log('PROOF_3_RETRIEVED_BY_CLIENT_ORDER_ID', { brokerOrderId: fetched.brokerOrderId, status: fetched.status });

  // 4. cancel if unfilled
  if (fetched.filledQty === 0) {
    const cancelled = await adapter.cancelOrder(result.brokerOrderId);
    log('PROOF_4_CANCELLED', { status: cancelled.status, rawStatus: cancelled.rawStatus });
  } else {
    log('PROOF_4_SKIPPED_CANCEL', { reason: 'unexpected fill', filledQty: fetched.filledQty });
  }

  // Confirm exactly one broker order was created.
  const count = await BrokerOrderModel.countDocuments({ clientOrderId: intent.clientOrderId });
  if (count !== 1) throw new Error(`expected exactly 1 broker order, found ${count}`);
  log('SMOKE_PASSED', { proofs: 4, brokerOrders: count });
} catch (error) {
  exitCode = 1;
  log('SMOKE_FAILED', { message: String(error?.message ?? error).slice(0, 400) });
} finally {
  await mongoose.disconnect().catch(() => undefined);
  await mongod.stop().catch(() => undefined);
}
process.exit(exitCode);
