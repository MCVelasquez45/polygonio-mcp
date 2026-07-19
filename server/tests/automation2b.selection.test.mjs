// Phase 2B — deterministic contract selection (pure function tests).
// Requirements 9, 10, 11, 12, 13.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist } from './automation.helpers.mjs';
import { FIXTURE_NOW, buildChain, buildAllRejectChain } from './automation2b.fixtures.mjs';

const mods = await loadDist();
const config = mods.getStrategyConfig();

test('9. bullish signals rank CALLS and select the best deterministically', () => {
  const result = mods.selectContract('BULLISH', buildChain('call'), config, FIXTURE_NOW);
  assert.equal(result.optionSide, 'call');
  assert.ok(result.candidates.every(c => c.type === 'call'), 'puts must not be considered');
  assert.ok(result.selected, 'a contract must be selected');
  assert.equal(result.selected.symbol, 'SPY260724C00500000', 'delta 0.60 beats 0.56 with equal liquidity');
  assert.equal(result.passedCount, 2);
  // Determinism: same inputs → identical output.
  const again = mods.selectContract('BULLISH', buildChain('call'), config, FIXTURE_NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(result)));
});

test('10. bearish signals rank PUTS', () => {
  const result = mods.selectContract('BEARISH', buildChain('put'), config, FIXTURE_NOW);
  assert.equal(result.optionSide, 'put');
  assert.ok(result.candidates.every(c => c.type === 'put'));
  assert.ok(result.selected);
  assert.equal(result.selected.symbol, 'SPY260724P00500000');
});

test('11. wide-spread contracts are rejected with SPREAD_TOO_WIDE', () => {
  const result = mods.selectContract('BULLISH', buildChain('call'), config, FIXTURE_NOW);
  const wide = result.candidates.find(c => c.symbol === 'SPY260724C00510000');
  assert.ok(wide);
  assert.equal(wide.passed, false);
  assert.ok(wide.rejectionReasons.includes('SPREAD_TOO_WIDE'));
  assert.ok(wide.spreadPct > config.contract.maxSpreadPct);
  assert.equal(typeof wide.spreadDollars, 'number', 'spread dollars persisted');
});

test('12. stale option quotes are rejected with STALE_QUOTE', () => {
  const result = mods.selectContract('BULLISH', buildChain('call'), config, FIXTURE_NOW);
  const stale = result.candidates.find(c => c.symbol === 'SPY260724C00515000');
  assert.ok(stale);
  assert.equal(stale.passed, false);
  assert.ok(stale.rejectionReasons.includes('STALE_QUOTE'));
  assert.ok(stale.quoteTimestamp instanceof Date, 'normalized quote timestamp persisted');
});

test('13. low open interest and low volume are rejected', () => {
  const result = mods.selectContract('BULLISH', buildChain('call'), config, FIXTURE_NOW);
  const lowOi = result.candidates.find(c => c.symbol === 'SPY260724C00520000');
  const lowVol = result.candidates.find(c => c.symbol === 'SPY260724C00525000');
  assert.ok(lowOi.rejectionReasons.includes('OPEN_INTEREST_TOO_LOW'));
  assert.ok(lowVol.rejectionReasons.includes('VOLUME_TOO_LOW'));
});

test('every considered contract carries score components and reasons', () => {
  const result = mods.selectContract('BULLISH', buildChain('call'), config, FIXTURE_NOW);
  assert.equal(result.consideredCount, 9); // opposite-side contract excluded
  for (const candidate of result.candidates) {
    assert.ok(candidate.scoreComponents, `${candidate.symbol} must carry score components`);
    if (!candidate.passed) {
      assert.ok(candidate.rejectionReasons.length > 0, `${candidate.symbol} must explain its rejection`);
    }
  }
  // DTE / delta / non-positive-quote rejects all present:
  const bySymbol = Object.fromEntries(result.candidates.map(c => [c.symbol, c]));
  assert.ok(bySymbol['SPY260724C00530000'].rejectionReasons.includes('DTE_OUT_OF_RANGE'));
  assert.ok(bySymbol['SPY260724C00535000'].rejectionReasons.includes('DELTA_OUT_OF_RANGE'));
  assert.ok(bySymbol['SPY260724C00540000'].rejectionReasons.includes('NON_POSITIVE_BID'));
});

test('no-selection carries an explicit reason (all-reject chain)', () => {
  const result = mods.selectContract('BULLISH', buildAllRejectChain('call'), config, FIXTURE_NOW);
  assert.equal(result.selected, null);
  assert.equal(result.noSelectionReason, 'NO_CONTRACT_PASSED_FILTERS');
  assert.equal(result.candidates.length, 2, 'full ranking still produced');
});
