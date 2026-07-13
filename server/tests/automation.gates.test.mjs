// Phase 2A gate tests: Mongo fail-closed, live-config rejection, market-clock
// entry blocks, and log redaction. (Required tests 1, 2, 8, 9, 15.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
  baseIntentInput,
} from './automation.helpers.mjs';

const mods = await loadDist();

test('1. automation refuses to initialize without MongoDB (fail closed)', async () => {
  mods.resetAutomationRuntimeForTests();
  mods.clearReconciliationStateForTests();
  const mock = new mods.MockPaperBrokerAdapter();

  const result = await mods.initializeAutomation({ adapter: mock });
  assert.equal(result.ready, false);
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(mods.isAutomationReady(), false);
  // No broker interaction may have happened.
  assert.equal(mock.submitCalls, 0);
});

test('2. live broker configuration is structurally rejected', async () => {
  const prev = process.env.ALPACA_PAPER;
  process.env.ALPACA_PAPER = 'false';
  try {
    assert.throws(
      () => mods.assertPaperConfiguration(),
      (error) => error.code === 'AUTOMATION_LIVE_TRADING_BLOCKED'
    );
    assert.throws(
      () => mods.createAlpacaPaperBrokerAdapter(),
      (error) => error.code === 'AUTOMATION_LIVE_TRADING_BLOCKED'
    );
  } finally {
    if (prev === undefined) delete process.env.ALPACA_PAPER;
    else process.env.ALPACA_PAPER = prev;
  }
});

test('market clock + submission gates (with Mongo up)', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  await t.test('8. unknown market status blocks entry', async () => {
    mods.clearMarketClockCache();
    const mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('unknown');
    const decision = await mods.getMarketClockDecision(mock, { force: true });
    assert.equal(decision.state, 'UNKNOWN');
    assert.equal(decision.canEnter, false);
    await assert.rejects(
      () => mods.assertEntryAllowed(mock),
      (error) => error.code === 'AUTOMATION_MARKET_CLOCK_BLOCKED'
    );
  });

  await t.test('9. closed market blocks entry (and blocks a real ENTRY submit)', async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    const mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('closed');

    const decision = await mods.getMarketClockDecision(mock, { force: true });
    assert.equal(decision.state, 'CLOSED');
    assert.equal(decision.canEnter, false);

    const session = await createReadySession(mods);
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id));
    await assert.rejects(
      () => mods.submitIntent(String(intent._id), mock),
      (error) => error.code === 'AUTOMATION_MARKET_CLOCK_BLOCKED'
    );
    assert.equal(mock.submitCalls, 0, 'no broker call may happen while the market is closed');
  });

  await t.test('unknown never silently defaults to open', async () => {
    mods.clearMarketClockCache();
    const mock = new mods.MockPaperBrokerAdapter();
    mock.failClock();
    const decision = await mods.getMarketClockDecision(mock, { force: true });
    assert.equal(decision.state, 'UNKNOWN');
    assert.equal(decision.canEnter, false);
    assert.ok(decision.reasons.some(reason => reason.includes('unknown market state blocks')));
  });
});

test('15. sensitive credentials are never written to logs', async () => {
  const captured = [];
  const original = console.log;
  console.log = (line) => captured.push(String(line));
  try {
    const record = mods.logAutomationEvent({
      service: 'test',
      event: 'REDACTION_CHECK',
      payload: {
        apiKey: 'SUPER-SECRET-KEY-123',
        alpacaSecret: 'SECRET-VALUE-456',
        authorization: 'Bearer abc.def.ghi',
        nested: { access_token: 'tok_789', safe: 'visible-value' },
        accountNumber: mods.maskAccountId('PA1234567890'),
      },
    });
    assert.equal(record.payload.apiKey, '[redacted]');
    assert.equal(record.payload.alpacaSecret, '[redacted]');
    assert.equal(record.payload.authorization, '[redacted]');
    assert.equal(record.payload.nested.access_token, '[redacted]');
    assert.equal(record.payload.nested.safe, 'visible-value');
    assert.equal(record.payload.accountNumber, '****7890');

    const joined = captured.join('\n');
    assert.ok(!joined.includes('SUPER-SECRET-KEY-123'));
    assert.ok(!joined.includes('SECRET-VALUE-456'));
    assert.ok(!joined.includes('abc.def.ghi'));
    assert.ok(!joined.includes('tok_789'));
    assert.ok(!joined.includes('PA1234567890'));
    // Every console record carries an ISO timestamp.
    const parsed = JSON.parse(captured.at(-1));
    assert.ok(!Number.isNaN(Date.parse(parsed.timestamp)));
  } finally {
    console.log = original;
  }
});
