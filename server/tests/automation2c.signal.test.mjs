// Phase 2C — options-native signal engine (pure). The default signal path uses
// ONLY authorized options data; balanced/stale/insufficient windows are
// NO_TRADE/DATA_REJECTED, never an improvised direction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist } from './automation.helpers.mjs';

const mods = await loadDist();
const cfg = mods.getOptionsFlowConfig();
const NOW = Date.parse('2026-07-10T15:00:00.000Z');

function side(overrides = {}) {
  return {
    volume: 100,
    premium: 10000,
    contracts: 3,
    avgIv: 0.3,
    openInterest: 4000,
    expirations: 2,
    ...overrides,
  };
}

function window(overrides = {}) {
  return {
    underlying: 'SPY',
    observationStart: NOW - 5 * 60_000,
    observationEnd: NOW,
    newestEventTs: NOW - 30_000,
    complete: true,
    call: side(),
    put: side(),
    baselineCallVolume: 300,
    baselinePutVolume: 300,
    ...overrides,
  };
}

test('options-native signal engine', async (t) => {
  await t.test('strong call flow → BULLISH with score and no reason codes', () => {
    const signal = mods.evaluateOptionsFlow(
      window({
        call: side({ volume: 800, premium: 80000, contracts: 6 }),
        put: side({ volume: 200, premium: 20000, contracts: 5 }),
      }),
      cfg,
      NOW
    );
    assert.equal(signal.direction, 'BULLISH');
    assert.ok(signal.score >= cfg.minScore);
    assert.deepEqual(signal.reasonCodes, []);
    assert.equal(signal.dataRejected, false);
    assert.equal(signal.featureSnapshot.netPremiumTilt, 0.6);
    assert.equal(signal.featureSnapshot.volumeRatio, 4);
  });

  await t.test('strong put flow → BEARISH', () => {
    const signal = mods.evaluateOptionsFlow(
      window({
        call: side({ volume: 200, premium: 20000, contracts: 5 }),
        put: side({ volume: 800, premium: 80000, contracts: 6 }),
      }),
      cfg,
      NOW
    );
    assert.equal(signal.direction, 'BEARISH');
    assert.ok(signal.featureSnapshot.netPremiumTilt <= -cfg.netPremiumTiltMin);
  });

  await t.test('balanced flow → NO_TRADE (OPTIONS_FLOW_BALANCED), never guessed', () => {
    const signal = mods.evaluateOptionsFlow(
      window({
        call: side({ volume: 500, premium: 50000, contracts: 6 }),
        put: side({ volume: 500, premium: 50000, contracts: 6 }),
      }),
      cfg,
      NOW
    );
    assert.equal(signal.direction, 'NO_TRADE');
    assert.ok(signal.reasonCodes.includes('OPTIONS_FLOW_BALANCED'));
    assert.equal(signal.dataRejected, false);
  });

  await t.test('incomplete window → DATA_REJECTED', () => {
    const signal = mods.evaluateOptionsFlow(
      window({ complete: false, call: side({ volume: 800, premium: 80000, contracts: 6 }) }),
      cfg,
      NOW
    );
    assert.equal(signal.direction, 'NO_TRADE');
    assert.ok(signal.reasonCodes.includes('OPTIONS_WINDOW_INCOMPLETE'));
    assert.equal(signal.dataRejected, true);
  });

  await t.test('stale window → DATA_REJECTED', () => {
    const signal = mods.evaluateOptionsFlow(
      window({ newestEventTs: NOW - 10 * 60_000, call: side({ volume: 800, premium: 80000, contracts: 6 }) }),
      cfg,
      NOW
    );
    assert.ok(signal.reasonCodes.includes('OPTIONS_WINDOW_STALE'));
    assert.equal(signal.dataRejected, true);
  });

  await t.test('insufficient volume → DATA_REJECTED', () => {
    const signal = mods.evaluateOptionsFlow(
      window({ call: side({ volume: 30, premium: 3000, contracts: 3 }), put: side({ volume: 20, premium: 2000, contracts: 3 }) }),
      cfg,
      NOW
    );
    assert.ok(signal.reasonCodes.includes('OPTIONS_WINDOW_INSUFFICIENT_VOLUME'));
    assert.equal(signal.dataRejected, true);
  });

  await t.test('insufficient contracts → DATA_REJECTED', () => {
    const signal = mods.evaluateOptionsFlow(
      window({ call: side({ volume: 400, premium: 40000, contracts: 1 }), put: side({ volume: 200, premium: 20000, contracts: 1 }) }),
      cfg,
      NOW
    );
    assert.ok(signal.reasonCodes.includes('OPTIONS_WINDOW_INSUFFICIENT_CONTRACTS'));
  });

  await t.test('deterministic: identical windows produce identical signals', () => {
    const w = window({ call: side({ volume: 800, premium: 80000, contracts: 6 }), put: side({ volume: 200, premium: 20000, contracts: 5 }) });
    const a = mods.evaluateOptionsFlow(w, cfg, NOW);
    const b = mods.evaluateOptionsFlow(w, cfg, NOW);
    assert.deepEqual(a, b);
  });

  await t.test('no AI, no stock data: signal is a pure function of the options window', () => {
    // The feature snapshot is derived only from call/put option aggregates.
    const signal = mods.evaluateOptionsFlow(
      window({ call: side({ volume: 800, premium: 80000, contracts: 6, avgIv: 0.28 }), put: side({ volume: 200, premium: 20000, contracts: 5, avgIv: 0.34 }) }),
      cfg,
      NOW
    );
    assert.equal(signal.featureSnapshot.callIv, 0.28);
    assert.equal(signal.featureSnapshot.putIv, 0.34);
    assert.ok(signal.featureSnapshot.ivSkew != null);
    assert.ok('callToPutPremiumRatio' in signal.featureSnapshot);
  });
});

test('options flow window builder (snapshot diff)', async (t) => {
  await t.test('window volume comes from day-volume delta, not open interest', () => {
    const contract = (symbol, type, volume, oi) => ({
      symbol,
      type,
      strike: 500,
      expiration: '2026-07-24',
      bid: 1.1,
      ask: 1.2,
      mid: 1.15,
      delta: type === 'call' ? 0.6 : -0.6,
      iv: 0.3,
      openInterest: oi,
      volume,
      quoteTimestamp: NOW - 20_000,
      tradable: true,
    });
    const baseline = { underlying: 'SPY', underlyingPrice: 500, fetchedAt: NOW - 5 * 60_000, contracts: [contract('C1', 'call', 100, 5000), contract('P1', 'put', 100, 5000)] };
    const current = { underlying: 'SPY', underlyingPrice: 500, fetchedAt: NOW, contracts: [contract('C1', 'call', 600, 5000), contract('P1', 'put', 200, 5000)] };
    const w = mods.buildFlowWindowFromSnapshots({
      underlying: 'SPY',
      baseline,
      current,
      observationStart: NOW - 5 * 60_000,
      observationEnd: NOW,
      baselineWindow: null,
    });
    // Call window volume = 600 - 100 = 500; put = 200 - 100 = 100.
    assert.equal(w.call.volume, 500);
    assert.equal(w.put.volume, 100);
    // OI is context only, never counted as window flow.
    assert.equal(w.call.openInterest, 5000);
  });
});
