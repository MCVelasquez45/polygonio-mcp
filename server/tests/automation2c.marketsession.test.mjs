// Phase 2C — market-hours phase policy (pure). Phases derive from the
// AUTHORITATIVE broker clock's next_close, so early-close/holiday days flatten
// on time without any hardcoded 9:30–16:00.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist } from './automation.helpers.mjs';

const mods = await loadDist();
const cfg = { finalEntryMinutesBeforeClose: 45, cancelEntryOrdersMinutesBeforeClose: 20, flattenMinutesBeforeClose: 15 };

function clock(isOpen, minutesToClose) {
  const now = Date.parse('2026-07-10T18:00:00.000Z');
  return {
    asOf: new Date(now),
    isOpen,
    nextOpen: new Date(now + 24 * 3600_000),
    nextClose: minutesToClose == null ? null : new Date(now + minutesToClose * 60_000),
    source: 'mock',
  };
}
const NOW = Date.parse('2026-07-10T18:00:00.000Z');

test('market session phases', async (t) => {
  await t.test('market closed → CLOSED, no entries', () => {
    const s = mods.deriveMarketSession(clock(false, null), cfg, NOW);
    assert.equal(s.phase, 'CLOSED');
    assert.equal(s.entriesAllowed, false);
    assert.equal(s.shouldFlatten, false);
  });

  await t.test('open, well before cutoff → PRE_CUTOFF, entries allowed', () => {
    const s = mods.deriveMarketSession(clock(true, 120), cfg, NOW);
    assert.equal(s.phase, 'PRE_CUTOFF');
    assert.equal(s.entriesAllowed, true);
  });

  await t.test('past final-entry cutoff → no new entries, still monitoring', () => {
    const s = mods.deriveMarketSession(clock(true, 40), cfg, NOW);
    assert.equal(s.phase, 'POST_ENTRY_CUTOFF');
    assert.equal(s.entriesAllowed, false);
    assert.equal(s.shouldFlatten, false);
  });

  await t.test('inside cancel window → cancel unfilled entries', () => {
    const s = mods.deriveMarketSession(clock(true, 18), cfg, NOW);
    assert.equal(s.phase, 'CANCEL_ENTRIES');
    assert.equal(s.shouldCancelEntries, true);
    assert.equal(s.entriesAllowed, false);
  });

  await t.test('inside flatten window → flatten (and still cancel)', () => {
    const s = mods.deriveMarketSession(clock(true, 10), cfg, NOW);
    assert.equal(s.phase, 'FLATTEN');
    assert.equal(s.shouldFlatten, true);
    assert.equal(s.shouldCancelEntries, true);
  });

  await t.test('early close (authoritative next_close) drives the phase, not wall clock', () => {
    // Only 12 minutes to an early close → FLATTEN regardless of time of day.
    const s = mods.deriveMarketSession(clock(true, 12), cfg, NOW);
    assert.equal(s.phase, 'FLATTEN');
  });

  await t.test('open but no authoritative close → fail safe, no entries', () => {
    const s = mods.deriveMarketSession(clock(true, null), cfg, NOW);
    assert.equal(s.entriesAllowed, false);
  });
});
