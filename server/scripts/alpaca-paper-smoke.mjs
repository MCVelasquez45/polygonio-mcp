// One-off Alpaca PAPER smoke test (Phase 2B pre-condition).
//
// Proves, through the Phase 2A adapter (never the SDK directly):
//   1. a paper order can be submitted with a deterministic client_order_id
//   2. it can be retrieved by client_order_id
//   3. it can be cancelled
//   4. its final broker status can be reconciled into the broker-order journal
//
// Deliberately NOT connected to any scheduler or market signal. Run manually:
//   cd server && npm run build && node scripts/alpaca-paper-smoke.mjs
//
// Safety: uses a far-out-of-the-money SPY call with a $0.01 limit (day) so it
// cannot realistically fill; everything happens on the PAPER account and the
// adapter's live-config guard runs first. No credentials are printed.

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const { createAlpacaPaperBrokerAdapter } = await import(
  '../dist/features/automation/services/alpacaPaperBrokerAdapter.service.js'
);
const { recordBrokerOrderSnapshot } = await import(
  '../dist/features/automation/services/orderIntent.service.js'
);

const key = process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? process.env.APCA_API_KEY_ID;
const secret =
  process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY;
if (!key || !secret) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), event: 'SMOKE_ABORT', reason: 'missing Alpaca credentials' }));
  process.exit(1);
}

function log(event, payload = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'alpaca-paper-smoke', event, ...payload }));
}

// --- contract discovery (paper REST, read-only; adapter handles the rest) ---
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
  const response = await fetch(url, {
    headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
  });
  if (!response.ok) throw new Error(`contract discovery failed: HTTP ${response.status}`);
  const body = await response.json();
  const contracts = Array.isArray(body?.option_contracts) ? body.option_contracts : [];
  if (!contracts.length) throw new Error('no active SPY call contracts found in 7-21 DTE window');
  // Highest strike in the window = far OTM; $0.01 limit will not fill.
  contracts.sort((a, b) => Number(b.strike_price) - Number(a.strike_price));
  return contracts[0];
}

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'smoke' });

let exitCode = 0;
try {
  const adapter = createAlpacaPaperBrokerAdapter(); // live-config guard runs here
  log('ADAPTER_READY', { broker: adapter.describe() });

  const account = await adapter.getAccount();
  log('ACCOUNT_OK', { accountIdMasked: account.accountIdMasked, isPaper: account.isPaper, currency: account.currency });
  const clock = await adapter.getClock();
  log('CLOCK_OK', { isOpen: clock.isOpen, nextOpen: clock.nextOpen, nextClose: clock.nextClose });

  const contract = await discoverFarOtmSpyCall();
  log('CONTRACT_SELECTED', { symbol: contract.symbol, strike: contract.strike_price, expiration: contract.expiration_date });

  // Deterministic client_order_id (same shape as Phase 2A: at2a- + 32 hex).
  const dayKey = new Date().toISOString().slice(0, 10);
  const clientOrderId = `at2a-${createHash('sha256').update(`smoke|${dayKey}|${contract.symbol}`).digest('hex').slice(0, 32)}`;
  log('CLIENT_ORDER_ID', { clientOrderId });

  // 1. submit
  const submitted = await adapter.submitOrder({
    intentId: 'smoke-test',
    idempotencyKey: clientOrderId,
    clientOrderId,
    symbol: contract.symbol,
    side: 'BUY',
    quantity: 1,
    orderType: 'limit',
    limitPrice: 0.01,
    timeInForce: 'day',
    intentType: 'ENTRY',
  });
  log('PROOF_1_SUBMITTED', { brokerOrderId: submitted.brokerOrderId, status: submitted.status, rawStatus: submitted.rawStatus });

  // 2. retrieve by client_order_id
  const fetched = await adapter.getOrderByClientOrderId(clientOrderId);
  if (!fetched || fetched.brokerOrderId !== submitted.brokerOrderId) {
    throw new Error('retrieval by client_order_id did not return the submitted order');
  }
  log('PROOF_2_RETRIEVED_BY_CLIENT_ORDER_ID', { brokerOrderId: fetched.brokerOrderId, status: fetched.status });

  // 3. cancel
  const cancelled = await adapter.cancelOrder(submitted.brokerOrderId);
  log('PROOF_3_CANCELLED', { status: cancelled.status, rawStatus: cancelled.rawStatus });

  // 4. reconcile final broker status into the journal (broker-truth only)
  await new Promise(resolve => setTimeout(resolve, 1500));
  const final = await adapter.getOrder(submitted.brokerOrderId);
  const journaled = await recordBrokerOrderSnapshot(final, { source: 'reconciliation' });
  log('PROOF_4_RECONCILED', {
    finalStatus: final.status,
    rawStatus: final.rawStatus,
    journaledStatus: journaled.status,
    journalSource: journaled.lastSource,
    historyLength: journaled.statusHistory.length,
  });

  const terminal = ['CANCELLED', 'CANCEL_PENDING', 'EXPIRED', 'REJECTED'];
  if (!terminal.includes(final.status)) {
    throw new Error(`unexpected final status ${final.status} (${final.rawStatus})`);
  }
  log('SMOKE_PASSED', { proofs: 4 });
} catch (error) {
  exitCode = 1;
  log('SMOKE_FAILED', { message: String(error?.message ?? error).slice(0, 400) });
} finally {
  await mongoose.disconnect().catch(() => undefined);
  await mongod.stop().catch(() => undefined);
}
process.exit(exitCode);
