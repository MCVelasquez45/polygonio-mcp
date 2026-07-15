// Sprint 2E — the Automation Universe Provider in isolation.
// Symbol normalization + dedupe, deterministic priority ordering, active-strategy
// filtering, and the cache lifecycle (miss → hit → TTL expiry → write-invalidation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist, startTestMongo, stopTestMongo, dropAutomationCollections } from './automation.helpers.mjs';

const mods = await loadDist();
const NOW = Date.parse('2026-07-10T15:00:00.000Z');

test('automation universe provider', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  const seed = (symbol, overrides = {}) =>
    mods.upsertWatchlistItem({ symbol, enabled: true, automationEnabled: true, strategy: 'OPTIONS_NATIVE_FLOW', ...overrides });

  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.resetAutomationUniverseProviderForTests();
  });

  await t.test('normalizes lowercase input and dedupes by symbol', async () => {
    await mods.upsertWatchlistItem({ symbol: 'spy', enabled: true, automationEnabled: true });
    await mods.upsertWatchlistItem({ symbol: 'SPY', enabled: true, automationEnabled: true, priority: 5 });
    const all = await mods.listWatchlist();
    assert.equal(all.length, 1, 'same symbol upserts to one record');
    assert.equal(all[0].symbol, 'SPY');
    const u = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(u.symbols, ['SPY']);
  });

  await t.test('rejects malformed symbols without crashing', async () => {
    await assert.rejects(() => mods.upsertWatchlistItem({ symbol: 'ABC123' }), /Invalid symbol/);
    const u = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(u.symbols, []);
  });

  await t.test('orders the universe deterministically by priority then symbol', async () => {
    await seed('AAA', { priority: 30 });
    await seed('BBB', { priority: 10 });
    await seed('CCC', { priority: 20 });
    mods.resetAutomationUniverseProviderForTests();
    const u = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(u.symbols, ['BBB', 'CCC', 'AAA']);
  });

  await t.test('skips symbols whose strategy is not the active one', async () => {
    await seed('SPY');
    await seed('QQQ', { strategy: 'EQUITY_MOMENTUM' });
    mods.resetAutomationUniverseProviderForTests();
    const u = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(u.symbols, ['SPY']);
    assert.equal(u.skipped.some((s) => s.symbol === 'QQQ' && s.reason === 'WATCHLIST_STRATEGY_INACTIVE'), true);
  });

  await t.test('all automation-disabled → empty universe', async () => {
    await seed('SPY', { automationEnabled: false });
    mods.resetAutomationUniverseProviderForTests();
    const u = await mods.getAutomationUniverse(NOW);
    assert.equal(u.empty, true);
    assert.deepEqual(u.symbols, []);
  });

  await t.test('cache: miss loads, hit serves the same snapshot, TTL expiry reloads', async () => {
    await seed('SPY');
    mods.resetAutomationUniverseProviderForTests();
    const first = await mods.getAutomationUniverse(NOW); // MISS → load
    const second = await mods.getAutomationUniverse(NOW + 1_000); // HIT (within TTL)
    assert.equal(first.loadedAt, second.loadedAt, 'cache hit returns the same snapshot');
    // External change (bypassing the service → no invalidation).
    await mods.WatchlistItemModel.updateOne({ symbol: 'SPY' }, { $set: { automationEnabled: false } });
    const ttl = mods.getAutomationUniverseRefreshTtlMs();
    const stillCached = await mods.getAutomationUniverse(NOW + ttl - 1);
    assert.deepEqual(stillCached.symbols, ['SPY'], 'within TTL the cached universe is reused');
    const reloaded = await mods.getAutomationUniverse(NOW + ttl + 1);
    assert.deepEqual(reloaded.symbols, [], 'past TTL the provider reloads and reflects the change');
  });

  await t.test('Sprint 2F eligibility fields pass through the universe item', async () => {
    await seed('SPY', { minimumOpenInterest: 750, minimumVolume: 300, maxSpreadPercent: 6, minDTE: 5, maxDTE: 30 });
    mods.resetAutomationUniverseProviderForTests();
    const u = await mods.getAutomationUniverse(NOW);
    assert.equal(u.items.SPY.minimumOpenInterest, 750);
    assert.equal(u.items.SPY.minimumVolume, 300);
    assert.equal(u.items.SPY.maxSpreadPercent, 6);
    assert.equal(u.items.SPY.minDTE, 5);
    assert.equal(u.items.SPY.maxDTE, 30);
  });

  await t.test('write-invalidation: a service write is visible on the next read (no restart)', async () => {
    await seed('SPY');
    const before = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(before.symbols, ['SPY']);
    await seed('QQQ'); // upsert invalidates the cache
    const after = await mods.getAutomationUniverse(NOW); // same instant, but cache was invalidated
    assert.equal(after.symbols.includes('QQQ'), true);
  });
});
