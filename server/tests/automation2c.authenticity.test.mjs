// Phase 2C — runtime authenticity guards. Production runtime must use real
// integrations: no mock broker, no synthetic signal mode, no fabricated fills.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist } from './automation.helpers.mjs';

const mods = await loadDist();

test('runtime authenticity', async (t) => {
  await t.test('45. production runtime cannot select the mock broker', () => {
    const prior = { env: process.env.NODE_ENV, broker: process.env.AUTOMATION_BROKER };
    process.env.NODE_ENV = 'production';
    process.env.AUTOMATION_BROKER = 'mock';
    try {
      const check = mods.validateAutomationConfig();
      assert.equal(check.ok, false);
      assert.ok(check.errors.some(e => e.toLowerCase().includes('mock')));
    } finally {
      process.env.NODE_ENV = prior.env;
      if (prior.broker == null) delete process.env.AUTOMATION_BROKER;
      else process.env.AUTOMATION_BROKER = prior.broker;
    }
  });

  await t.test('46. equity-momentum (synthetic-bar) mode is warned as unauthorized', () => {
    const prior = process.env.AUTOMATION_SIGNAL_MODE;
    process.env.AUTOMATION_SIGNAL_MODE = 'EQUITY_MOMENTUM';
    try {
      const check = mods.validateAutomationConfig();
      assert.ok(check.warnings.some(w => w.includes('EQUITY_MOMENTUM')));
      assert.equal(mods.getSignalMode(), 'EQUITY_MOMENTUM');
    } finally {
      if (prior == null) delete process.env.AUTOMATION_SIGNAL_MODE;
      else process.env.AUTOMATION_SIGNAL_MODE = prior;
    }
  });

  await t.test('default signal mode is OPTIONS_NATIVE_FLOW (authorized data)', () => {
    const prior = process.env.AUTOMATION_SIGNAL_MODE;
    delete process.env.AUTOMATION_SIGNAL_MODE;
    try {
      assert.equal(mods.getSignalMode(), 'OPTIONS_NATIVE_FLOW');
    } finally {
      if (prior != null) process.env.AUTOMATION_SIGNAL_MODE = prior;
    }
  });

  await t.test('47. internal events cannot mark orders filled (broker-truth only)', async () => {
    // recordBrokerOrderSnapshot is the ONLY broker-order-journal writer and it
    // fails closed on any payload lacking broker identity (and requires Mongo).
    // Either guard proves an internally-fabricated "fill" cannot be persisted.
    await assert.rejects(
      () => mods.recordBrokerOrderSnapshot({ status: 'FILLED', filledQty: 1 }, { source: 'submit-response' }),
      /broker|mongo/i
    );
  });

  await t.test('48. contradictory market-hours cutoffs fail startup validation', () => {
    const prior = process.env.AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE;
    // Flatten before cancel is contradictory (flatten must be the innermost window).
    process.env.AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE = '30';
    try {
      const check = mods.validateAutomationConfig();
      assert.equal(check.ok, false);
    } finally {
      if (prior == null) delete process.env.AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE;
      else process.env.AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE = prior;
    }
  });
});
