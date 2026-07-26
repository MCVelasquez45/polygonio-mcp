import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

async function loadDecisionEngineDist() {
  const [scanner, ranking, journal, model] = await Promise.all([
    import('../dist/features/decisionEngine/scanner.service.js'),
    import('../dist/features/decisionEngine/ranking.service.js'),
    import('../dist/features/decisionEngine/journal.service.js'),
    import('../dist/features/decisionEngine/decisionScanJournal.model.js'),
  ]);
  return { ...scanner, ...ranking, ...journal, ...model };
}

function contract(overrides = {}) {
  return {
    symbol: overrides.symbol ?? 'O:SPY260821C00500000',
    type: overrides.type ?? 'call',
    strike: 500,
    expiration: '2026-08-21',
    dte: 10,
    bid: overrides.bid ?? 4.9,
    ask: overrides.ask ?? 5.0,
    mid: overrides.mid ?? 4.95,
    spread: overrides.spread ?? 0.1,
    spreadPct: overrides.spreadPct ?? 0.0202,
    volume: overrides.volume ?? 1200,
    openInterest: overrides.openInterest ?? 2500,
    iv: overrides.iv ?? 0.31,
    delta: overrides.delta ?? 0.52,
    gamma: 0.03,
    theta: -0.04,
    vega: 0.11,
    quoteTimestamp: '2026-08-10T14:35:00.000Z',
  };
}

function scanInput(overrides = {}) {
  return {
    now: Date.parse('2026-08-10T14:35:00.000Z'),
    marketStatus: overrides.marketStatus ?? 'open',
    watchlist: [
      {
        symbol: 'SPY',
        priority: 1,
        minConfidence: 0.5,
        maxSpreadPercent: 8,
        minimumOpenInterest: 200,
        minimumVolume: 50,
        maximumIV: 0.8,
      },
    ],
    chains: {
      SPY: {
        underlyingPrice: 501.25,
        underlyingTimeframe: 'DELAYED',
        complete: overrides.complete ?? true,
        contracts: overrides.contracts ?? [contract()],
      },
    },
  };
}

test('decision engine scores accepted candidates with explainable score components and JSON research', async () => {
  const mods = await loadDecisionEngineDist();
  const scan = mods.buildDecisionScan(scanInput());
  assert.equal(scan.candidates.length, 1);
  assert.equal(scan.winner.contract.symbol, 'O:SPY260821C00500000');
  assert.equal(scan.ranking.bestOpportunity.id, scan.winner.id);
  assert.equal(scan.candidates[0].rejectionCodes.length, 0);
  assert.ok(scan.candidates[0].scores.liquidity.explanation.includes('volume'));
  assert.equal(scan.aiReasoning[0].contract, 'O:SPY260821C00500000');
  assert.equal(scan.aiReasoning[0].expectedMove.source, 'SUPPLIED_IV');
});

test('decision engine rejects weak candidates with reason codes and explanations', async () => {
  const mods = await loadDecisionEngineDist();
  const scan = mods.buildDecisionScan(scanInput({
    contracts: [
      contract({
        symbol: 'O:SPY260821C00450000',
        bid: 1,
        ask: 1.4,
        mid: 1.2,
        spread: 0.4,
        spreadPct: 0.3333,
        volume: 2,
        openInterest: 10,
        iv: 1.2,
      }),
    ],
  }));
  assert.equal(scan.winner, null);
  assert.equal(scan.noTradeReason, 'No candidate cleared all decision-engine gates.');
  assert.ok(scan.rejections[0].reasonCode);
  assert.ok(scan.rejections[0].explanation.includes('rejected'));
  assert.ok(scan.candidates[0].rejectionCodes.includes('LOW_VOLUME'));
  assert.ok(scan.candidates[0].rejectionCodes.includes('HIGH_SPREAD'));
});

test('decision engine journal is append-only and latest scan is replayable', async () => {
  const mongod = await startTestMongo();
  try {
    const mods = await loadDecisionEngineDist();
    await mods.DecisionScanJournalModel.deleteMany({});
    await mods.DecisionScanJournalModel.syncIndexes();
    const first = await mods.runDecisionEngineScan(scanInput());
    const second = await mods.runDecisionEngineScan(scanInput({
      contracts: [contract({ symbol: 'O:SPY260821P00500000', type: 'put' })],
    }));
    assert.notEqual(first.scanId, second.scanId);
    const scans = await mods.listDecisionScans(10);
    assert.equal(scans.length, 2);
    assert.equal(scans[0].scanId, second.scanId);
    const replay = await mods.getDecisionScanById(first.scanId);
    assert.equal(replay.scanId, first.scanId);
    assert.equal(replay.schemaVersion, 1);
  } finally {
    await stopTestMongo(mongod);
  }
});
