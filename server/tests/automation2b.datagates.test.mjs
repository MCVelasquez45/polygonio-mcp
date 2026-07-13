// Phase 2B fail-closed data gates (Options Advanced alignment).
//  11. an incomplete required expiration window is rejected (DATA_INCOMPLETE)
//  13. same-day expirations are DTE 0 (never -1)
//  14. expired contracts are excluded from consideration
//  19. missing authorized underlying data blocks evaluation
//  20. previous-close stock data cannot satisfy a real-time gate
//  24. no signal path references broker submission
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDist } from './automation.helpers.mjs';
import { FIXTURE_NOW, buildChain } from './automation2b.fixtures.mjs';

const mods = await loadDist();
const marketData = await import('../dist/features/automation/services/automationMarketData.service.js');
const config = mods.getStrategyConfig();

const completeness = (complete) => ({
  complete,
  snapshotPagesFetched: 1,
  referencePagesFetched: 1,
  snapshotNextCursor: complete ? null : 'cursor-tail',
  referenceNextCursor: null,
  truncated: !complete,
  truncationReason: complete ? null : 'SNAPSHOT_PAGE_BUDGET_EXHAUSTED',
  coveredExpirationStart: '2026-07-20',
  coveredExpirationEnd: '2026-08-03',
  fetchedAt: new Date(FIXTURE_NOW).toISOString(),
});

test('11. incomplete required window → NO_CONTRACT_SELECTED / DATA_INCOMPLETE, no candidates ranked', () => {
  const chain = { ...buildChain('call'), completeness: completeness(false) };
  const result = mods.selectContract('BULLISH', chain, config, FIXTURE_NOW);
  assert.equal(result.selected, null, 'no contract may be selected from a partial chain');
  assert.equal(result.noSelectionReason, 'DATA_INCOMPLETE');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.consideredCount, 0);
});

test('a complete window ranks normally (18: authorized fresh data permits evaluation)', () => {
  const chain = { ...buildChain('call'), completeness: completeness(true) };
  const result = mods.selectContract('BULLISH', chain, config, FIXTURE_NOW);
  assert.ok(result.selected, 'complete + fresh chain selects a contract');
});

test('13. same-day expirations compute DTE 0, never -1', async () => {
  const { computeDteEt } = await import('../dist/shared/time/tradingCalendar.js');
  // FIXTURE_NOW = 2026-07-10T15:00Z → 11:00 ET Friday.
  assert.equal(computeDteEt('2026-07-10', FIXTURE_NOW), 0);
});

test('14. expired contracts are excluded from consideration entirely', () => {
  const chain = buildChain('call');
  const expired = {
    ...chain.contracts[0],
    symbol: 'SPY260709C00500000',
    expiration: '2026-07-09', // the day before FIXTURE_NOW
  };
  const withExpired = { ...chain, contracts: [...chain.contracts, expired] };
  const result = mods.selectContract('BULLISH', withExpired, config, FIXTURE_NOW);
  assert.ok(
    !result.candidates.some(c => c.symbol === 'SPY260709C00500000'),
    'expired contracts never appear as candidates'
  );
});

test('19. blocked intraday entitlement yields UNDERLYING_DATA_UNAUTHORIZED', () => {
  const codes = marketData.assessUnderlyingAuthorization({
    intradayEntitlement: 'blocked',
    resultGranularity: 'intraday',
    marketClosed: false,
    health: { mode: 'DEGRADED', source: 'cache' },
  });
  assert.ok(codes.includes('UNDERLYING_DATA_UNAUTHORIZED'));
});

test('20. previous-close / daily fallback cannot satisfy the real-time underlying gate', () => {
  // Daily-granularity fallback (prev close served while market open).
  const daily = marketData.assessUnderlyingAuthorization({
    intradayEntitlement: 'ok',
    resultGranularity: 'daily',
    marketClosed: false,
    health: { mode: 'BACKFILLING', source: 'rest' },
  });
  assert.ok(daily.includes('UNDERLYING_DATA_NOT_REALTIME'));

  // Snapshot-derived synthetic bar.
  const snapshot = marketData.assessUnderlyingAuthorization({
    intradayEntitlement: 'ok',
    resultGranularity: 'intraday',
    marketClosed: false,
    health: { mode: 'LIVE', source: 'snapshot' },
  });
  assert.ok(snapshot.includes('UNDERLYING_DATA_NOT_REALTIME'));

  // Genuinely live intraday REST data is authorized.
  const live = marketData.assessUnderlyingAuthorization({
    intradayEntitlement: 'ok',
    resultGranularity: 'intraday',
    marketClosed: false,
    health: { mode: 'LIVE', source: 'rest' },
  });
  assert.deepEqual(live, []);
});

test('17. stale quotes are rejected even when the chain is complete (WS down + stale REST)', () => {
  const chain = { ...buildChain('call'), completeness: completeness(true) };
  const staleContracts = chain.contracts.map(c => ({
    ...c,
    quoteTimestamp: FIXTURE_NOW - (config.contract.quoteMaxAgeMs + 60_000),
  }));
  const result = mods.selectContract('BULLISH', { ...chain, contracts: staleContracts }, config, FIXTURE_NOW);
  assert.equal(result.selected, null, 'no entry on stale quotes');
  assert.ok(
    result.candidates.every(c => c.rejectionReasons.includes('STALE_QUOTE')),
    'every stale contract carries STALE_QUOTE'
  );
});

test('24. the decision pipeline never references broker submission', async () => {
  const source = await readFile(
    new URL('../dist/features/automation/services/closedBarProcessor.service.js', import.meta.url),
    'utf8'
  );
  assert.ok(!source.includes('submitIntent'), 'closed-bar processor must not import submitIntent');
  assert.ok(!source.includes('submitOrder'), 'closed-bar processor must not call submitOrder');
  const orchestratorSource = await readFile(
    new URL('../dist/features/marketData/optionsMarketDataOrchestrator.service.js', import.meta.url),
    'utf8'
  );
  assert.ok(!orchestratorSource.includes('submitOrder'), 'orchestrator is market-data only');
});
