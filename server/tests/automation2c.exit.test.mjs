// Phase 2C — exit decision engine (pure). Priority-ordered triggers; one
// reason wins; price triggers require a valid mark (data-outage safety).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist } from './automation.helpers.mjs';

const mods = await loadDist();

function ctx(overrides = {}) {
  return {
    emergencyStop: false,
    flatten: false,
    brokerClosed: false,
    strategyInvalidated: false,
    currentMark: 1.2,
    avgEntryPrice: 1.0,
    stopPrice: 0.75,
    targetPrice: 1.3,
    ...overrides,
  };
}

test('exit decision engine', async (t) => {
  await t.test('no trigger → no exit', () => {
    const d = mods.evaluateExit(ctx());
    assert.equal(d.shouldExit, false);
    assert.equal(d.reason, null);
  });

  await t.test('profit target hit → PROFIT_TARGET', () => {
    const d = mods.evaluateExit(ctx({ currentMark: 1.35 }));
    assert.equal(d.reason, 'PROFIT_TARGET');
  });

  await t.test('stop hit → HARD_STOP', () => {
    const d = mods.evaluateExit(ctx({ currentMark: 0.7 }));
    assert.equal(d.reason, 'HARD_STOP');
  });

  await t.test('emergency stop outranks everything', () => {
    const d = mods.evaluateExit(ctx({ emergencyStop: true, currentMark: 1.35, flatten: true }));
    assert.equal(d.reason, 'EMERGENCY_STOP');
    assert.ok(d.activeTriggers.includes('PROFIT_TARGET'));
    assert.ok(d.activeTriggers.includes('END_OF_DAY'));
  });

  await t.test('end-of-day outranks profit target', () => {
    const d = mods.evaluateExit(ctx({ flatten: true, currentMark: 1.35 }));
    assert.equal(d.reason, 'END_OF_DAY');
  });

  await t.test('simultaneous stop + target → highest priority (HARD_STOP)', () => {
    // Degenerate band where both would fire; HARD_STOP outranks PROFIT_TARGET.
    const d = mods.evaluateExit(ctx({ stopPrice: 1.4, targetPrice: 1.1, currentMark: 1.2 }));
    assert.equal(d.reason, 'HARD_STOP');
  });

  await t.test('no mark → price triggers suppressed (data-outage safety)', () => {
    const d = mods.evaluateExit(ctx({ currentMark: null }));
    assert.equal(d.shouldExit, false);
  });

  await t.test('no mark but emergency stop still exits', () => {
    const d = mods.evaluateExit(ctx({ currentMark: null, emergencyStop: true }));
    assert.equal(d.reason, 'EMERGENCY_STOP');
  });

  await t.test('computeExitLevels derives stop/target from entry premium', () => {
    const levels = mods.computeExitLevels(2.0, 0.25, 0.3);
    assert.equal(levels.stopPrice, 1.5);
    assert.equal(levels.targetPrice, 2.6);
  });
});
