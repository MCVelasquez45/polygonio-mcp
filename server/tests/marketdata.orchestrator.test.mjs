// Options Market Data Orchestrator — single owner of chain data.
//  1. concurrent identical chain requests coalesce into ONE provider fetch
//  2. snapshot and reference data use separate TTL policies
//  3. cached reference contracts are NOT re-fetched on snapshot refresh
//  10. truncated pagination is marked incomplete
//  + narrow provider filters (expiration window / type / strike range)
//  + integration: five consumers → one operation → same normalized result
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ---- fake Massive with the REAL v3 flat snapshot shape (verified via MCP) --
const NS = 1_783_953_072_546_330_922n; // ns provider timestamp from the live probe

function contractRow(strike, expiration) {
  const padded = String(strike * 1000).padStart(8, '0');
  const ymd = expiration.slice(2).replaceAll('-', '');
  return {
    details: {
      ticker: `O:SPY${ymd}C${padded}`,
      contract_type: 'call',
      expiration_date: expiration,
      strike_price: strike,
      shares_per_contract: 100,
      exercise_style: 'american',
    },
    greeks: { delta: 0.6, gamma: 0.01, theta: -0.05, vega: 0.1 },
    implied_volatility: 0.22,
    open_interest: 640,
    day: { volume: 1500 },
    last_quote: {
      bid: 1.0,
      ask: 1.1,
      midpoint: 1.05,
      bid_size: 10,
      ask_size: 12,
      last_updated: Number(NS),
      timeframe: 'REAL-TIME',
    },
    underlying_asset: { price: 501.25, ticker: 'SPY', last_updated: Number(NS), timeframe: 'DELAYED' },
  };
}

function referenceRow(strike, expiration) {
  const padded = String(strike * 1000).padStart(8, '0');
  const ymd = expiration.slice(2).replaceAll('-', '');
  return {
    ticker: `O:SPY${ymd}C${padded}`,
    underlying_ticker: 'SPY',
    contract_type: 'call',
    expiration_date: expiration,
    strike_price: strike,
  };
}

const counts = { snapshot: 0, reference: 0, status: 0 };
const seenSnapshotParams = [];
const seenReferenceParams = [];
let snapshotServesNextPage = false;
let snapshotReturnsEmpty = false;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/v1/marketstatus/now') {
    counts.status += 1;
    res.end(JSON.stringify({ market: 'open', serverTime: new Date().toISOString(), afterHours: false, earlyHours: false }));
    return;
  }
  if (url.pathname === '/v3/snapshot/options/SPY') {
    counts.snapshot += 1;
    seenSnapshotParams.push(Object.fromEntries(url.searchParams));
    const body = {
      status: 'OK',
      results: snapshotReturnsEmpty ? [] : [contractRow(500, '2026-07-24'), contractRow(505, '2026-07-24')],
    };
    if (snapshotServesNextPage && !url.searchParams.get('cursor')) {
      body.next_url = `http://127.0.0.1:${server.address().port}/v3/snapshot/options/SPY?cursor=PAGE2`;
    }
    res.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === '/v3/reference/options/contracts') {
    counts.reference += 1;
    seenReferenceParams.push(Object.fromEntries(url.searchParams));
    if (url.searchParams.has('underlying_asset')) {
      res.end(JSON.stringify({ status: 'OK', results: [] }));
      return;
    }
    res.end(JSON.stringify({ status: 'OK', results: [referenceRow(500, '2026-07-24'), referenceRow(505, '2026-07-24')] }));
    return;
  }
  res.end(JSON.stringify({ status: 'OK', results: [] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

process.env.MASSIVE_API_KEY = 'test-key';
process.env.MASSIVE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.MASSIVE_MIN_INTERVAL_MS = '0';
process.env.MASSIVE_MAX_CONCURRENT = '4';
process.env.MASSIVE_MAX_RETRIES = '0';
process.env.MASSIVE_SNAPSHOT_MAX_PAGES = '1'; // page budget for the truncation test
process.env.OPTIONS_CHAIN_CACHE_OPEN_TTL_MS = '1000';
process.env.OPTIONS_UNDERLYING_CONTEXT_TTL_MS = '1000';

const orchestrator = await import('../dist/features/marketData/optionsMarketDataOrchestrator.service.js');
const chainCache = await import('../dist/features/marketData/optionsChainCache.service.js');
const massive = await import('../dist/shared/data/massive.js');

test('1 + integration: five concurrent identical requests → one provider operation, same result', async () => {
  chainCache.clearChainCache();
  const snapBefore = counts.snapshot;
  const request = {
    underlying: 'SPY',
    contractType: 'call',
    expirationGte: '2026-07-20',
    expirationLte: '2026-08-03',
    limit: 250,
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => orchestrator.getOptionChainWindow(request))
  );
  assert.equal(counts.snapshot - snapBefore, 1, 'exactly one snapshot fetch for five consumers');
  const [first, ...rest] = results;
  for (const other of rest) {
    assert.deepEqual(JSON.parse(JSON.stringify(other)), JSON.parse(JSON.stringify(first)), 'all consumers share the same normalized chain');
  }
  assert.equal(first.ticker, 'SPY');
  assert.equal(first.underlyingPrice, 501.25);
  assert.equal(first.underlyingContext.timeframe, 'DELAYED', 'delayed underlying must be labeled');
  assert.ok(first.underlyingContext.lastUpdated > 0, 'provider timestamp preserved');
  assert.equal(first.completeness.complete, true);
  assert.equal(first.expirations[0].expiration, '2026-07-24');
  assert.equal(first.expirations[0].dte >= 0, true, 'no negative DTE in a served chain');
});

test('narrow filters are forwarded to the provider query', async () => {
  const last = seenSnapshotParams[seenSnapshotParams.length - 1];
  assert.equal(last['expiration_date.gte'], '2026-07-20');
  assert.equal(last['expiration_date.lte'], '2026-08-03');
  assert.equal(last['contract_type'], 'call');
});

test('reference contract queries use canonical underlying_ticker only', async () => {
  const last = seenReferenceParams[seenReferenceParams.length - 1];
  assert.equal(last['underlying_ticker'], 'SPY');
  assert.equal(last['underlying_asset'], undefined);
});

test('UI chain remains populated from reference contracts when snapshot rows are empty', async () => {
  chainCache.clearChainCache();
  snapshotReturnsEmpty = true;
  try {
    const chain = await orchestrator.getOptionChainWindow({
      underlying: 'SPY',
      expiration: '2026-07-24',
      limit: 500,
    });
    assert.equal(chain.expirations.length, 1);
    assert.equal(chain.expirations[0].expiration, '2026-07-24');
    assert.equal(chain.expirations[0].strikes.length, 2);
    assert.equal(chain.expirations[0].strikes[0].call.ticker, 'O:SPY260724C00500000');
  } finally {
    snapshotReturnsEmpty = false;
  }
});

test('expiration list is populated from reference contracts', async () => {
  const payload = await massive.listOptionExpirations('SPY', { limit: 1000, maxPages: 1 });
  assert.deepEqual(payload.expirations, ['2026-07-24']);
  const last = seenReferenceParams[seenReferenceParams.length - 1];
  assert.equal(last['underlying_ticker'], 'SPY');
  assert.equal(last['underlying_asset'], undefined);
});

test('getAutomationChain narrows by DTE window, direction, and strike range', async () => {
  chainCache.clearChainCache();
  const now = Date.parse('2026-07-13T14:30:00Z');
  await orchestrator.getAutomationChain({
    underlying: 'SPY',
    direction: 'BULLISH',
    dteMin: 7,
    dteMax: 21,
    underlyingPriceHint: 500,
    now,
  });
  const last = seenSnapshotParams[seenSnapshotParams.length - 1];
  assert.equal(last['expiration_date.gte'], '2026-07-20', '7 DTE from Monday 2026-07-13');
  assert.equal(last['expiration_date.lte'], '2026-08-03', '21 DTE');
  assert.equal(last['contract_type'], 'call', 'bullish → calls only');
  assert.equal(Number(last['strike_price.gte']), 440, '±12% strike window');
  assert.equal(Number(last['strike_price.lte']), 560);
});

test('2+3: snapshot refreshes do NOT re-fetch cached reference contracts', async () => {
  chainCache.clearChainCache();
  const request = { underlying: 'SPY', contractType: 'call', expirationGte: '2026-07-20', expirationLte: '2026-08-03', limit: 250 };
  await orchestrator.getOptionChainWindow(request);
  const snapAfterFirst = counts.snapshot;
  const refAfterFirst = counts.reference;

  // Force the chain cache stale (snapshot TTL policy), then refresh.
  chainCache.clearChainCache();
  await orchestrator.getOptionChainWindow(request);

  assert.equal(counts.snapshot, snapAfterFirst + 1, 'snapshot pages re-fetched (short TTL policy)');
  assert.equal(counts.reference, refAfterFirst, 'reference pages served from the long-TTL cache');
});

test('10: pagination past the page budget is marked incomplete/truncated', async () => {
  chainCache.clearChainCache();
  snapshotServesNextPage = true;
  try {
    const chain = await orchestrator.getOptionChainWindow({
      underlying: 'SPY',
      contractType: 'call',
      expirationGte: '2026-07-20',
      expirationLte: '2026-08-04', // distinct key from prior tests
      limit: 250,
    });
    assert.equal(chain.completeness.complete, false);
    assert.equal(chain.completeness.truncated, true);
    assert.equal(chain.completeness.truncationReason, 'SNAPSHOT_PAGE_BUDGET_EXHAUSTED');
    assert.equal(chain.completeness.snapshotPagesFetched, 1);
    assert.equal(typeof chain.completeness.snapshotNextCursor, 'string', 'cursor recorded for resumption');
  } finally {
    snapshotServesNextPage = false;
  }
});

test('underlying context comes from a single one-row options snapshot (never a stock endpoint)', async () => {
  const snapBefore = counts.snapshot;
  const context = await orchestrator.getUnderlyingContext('SPY');
  assert.equal(counts.snapshot - snapBefore, 1);
  const last = seenSnapshotParams[seenSnapshotParams.length - 1];
  assert.equal(last.limit, '1', 'one-row snapshot');
  assert.equal(context.price, 501.25);
  assert.equal(context.timeframe, 'DELAYED');
  assert.equal(context.source, 'options-snapshot');
  // Cached: immediate second call issues no request.
  await orchestrator.getUnderlyingContext('SPY');
  assert.equal(counts.snapshot - snapBefore, 1, 'context cached');
});

test.after(() => {
  server.close();
});
