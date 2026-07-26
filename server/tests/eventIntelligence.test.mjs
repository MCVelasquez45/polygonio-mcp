import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

async function loadEventDist() {
  const [
    classifier,
    impact,
    importance,
    processor,
    history,
    trigger,
    journal,
    model,
    routes,
    decisionScanner,
    decisionJournalModel,
    tradeReportModel,
  ] = await Promise.all([
    import('../dist/features/eventIntelligence/classification/classifier.service.js'),
    import('../dist/features/eventIntelligence/impact/impact.service.js'),
    import('../dist/features/eventIntelligence/impact/importance.service.js'),
    import('../dist/features/eventIntelligence/events/eventProcessor.service.js'),
    import('../dist/features/eventIntelligence/storage/historicalSimilarity.service.js'),
    import('../dist/features/eventIntelligence/events/decisionTrigger.service.js'),
    import('../dist/features/eventIntelligence/storage/eventJournal.service.js'),
    import('../dist/features/eventIntelligence/storage/eventIntelligence.model.js'),
    import('../dist/features/eventIntelligence/routes/eventIntelligence.routes.js'),
    import('../dist/features/decisionEngine/scanner.service.js'),
    import('../dist/features/intelligence/models/decisionJournal.model.js'),
    import('../dist/features/intelligence/models/tradeReport.model.js'),
  ]);
  return {
    ...classifier,
    ...impact,
    ...importance,
    ...processor,
    ...history,
    ...trigger,
    ...journal,
    ...model,
    ...routes,
    ...decisionScanner,
    ...decisionJournalModel,
    ...tradeReportModel,
  };
}

function event(overrides = {}) {
  return {
    id: overrides.id ?? 'event:test:iran-ceasefire',
    provider: 'massive-market-news',
    timestamp: overrides.timestamp ?? '2026-07-25T14:00:00.000Z',
    title: overrides.title ?? 'Iran ceasefire sends crude oil lower',
    summary: overrides.summary ?? 'Energy markets react as oil volatility moves lower.',
    category: overrides.category ?? 'News',
    sentiment: overrides.sentiment ?? { label: 'bullish', score: 0.91, explanation: 'supplied' },
    symbols: overrides.symbols ?? ['OXY'],
    sectors: overrides.sectors ?? [],
    confidence: overrides.confidence ?? 0.8,
    importance: overrides.importance ?? 0,
    importanceExplanation: 'pending',
    source: 'Unit test',
    url: null,
    raw: {},
  };
}

test('event classification identifies oil/geopolitical context and sectors', async () => {
  const mods = await loadEventDist();
  const classified = mods.enrichEventClassification(event());
  assert.equal(classified.category, 'Oil');
  assert.ok(classified.sectors.includes('Energy'));
  assert.ok(classified.confidence >= 0.8);
});

test('event impact and importance explain affected assets', async () => {
  const mods = await loadEventDist();
  const classified = mods.enrichEventClassification(event());
  const impact = mods.estimateMarketImpact(classified);
  const scored = mods.scoreEventImportance({
    event: { ...classified, timestamp: new Date().toISOString() },
    impact,
    historicalSimilarity: { similarEvents: [{ decisionId: 'd1' }] },
  });
  assert.ok(impact.affectedSymbols.includes('OXY'));
  assert.ok(impact.affectedEtfs.includes('XLE'));
  assert.ok(impact.affectedCommodities.includes('Oil'));
  assert.ok(scored.importance > 50);
  assert.ok(scored.explanation.includes('Importance'));
});

test('historical lookup reads decision journal and trade reports without mutation', async () => {
  const mongod = await startTestMongo();
  try {
    const mods = await loadEventDist();
    await mods.DecisionJournalModel.collection.insertOne({
      decisionId: 'decision:oil:1',
      timestamp: new Date('2026-07-20T14:00:00.000Z'),
      context: { symbol: 'OXY', contract: 'OXY260821C00060000' },
      reasonSummary: { humanSummary: 'Oil event affected energy trade.' },
    });
    await mods.TradeReportModel.collection.insertOne({
      tradeId: 'trade:oil:1',
      identity: { underlying: 'OXY' },
      lifecycle: { holdTimeMinutes: 42 },
      performance: { realizedPnl: 12, returnPct: 0.08 },
      createdAt: new Date('2026-07-20T15:00:00.000Z'),
    });
    const classified = mods.enrichEventClassification(event());
    const impact = mods.estimateMarketImpact(classified);
    const history = await mods.findHistoricalSimilarity(classified, impact);
    assert.equal(history.similarEvents.length, 1);
    assert.equal(history.previousTrades, 1);
    assert.equal(history.historicalWinRate, 1);
    assert.equal(history.averageHoldingTimeMinutes, 42);
  } finally {
    await stopTestMongo(mongod);
  }
});

test('processing normalizes, journals, and marks high-importance events as decision triggers', async () => {
  const mongod = await startTestMongo();
  try {
    const mods = await loadEventDist();
    await mods.EventIntelligenceModel.deleteMany({});
    const record = await mods.processMarketEvent({
      ...event({ timestamp: new Date().toISOString() }),
      confidence: 0.95,
      symbols: ['OXY', 'CVX'],
    }, { persist: true, triggerDecisionEngine: false });
    assert.equal(record.decisionTrigger.status, 'TRIGGERED');
    assert.equal(record.decisionTrigger.decisionScanId, null);
    const latest = await mods.getLatestEventRecord();
    assert.equal(latest.event.id, record.event.id);
    assert.ok(latest.event.importance >= 80);
  } finally {
    await stopTestMongo(mongod);
  }
});

test('event intelligence read-only API exposes events, symbol, sector, and context', async () => {
  const mongod = await startTestMongo();
  let server;
  try {
    const mods = await loadEventDist();
    await mods.EventIntelligenceModel.deleteMany({});
    await mods.processMarketEvent({
      ...event({ timestamp: new Date().toISOString() }),
      confidence: 0.95,
      symbols: ['OXY', 'CVX'],
    }, { persist: true, triggerDecisionEngine: false });
    const app = express();
    app.use('/api/event-intelligence', mods.eventIntelligenceRouter);
    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const [eventsRes, latestRes, symbolRes, sectorRes, contextRes] = await Promise.all([
      fetch(`${base}/api/event-intelligence/events`),
      fetch(`${base}/api/event-intelligence/latest`),
      fetch(`${base}/api/event-intelligence/symbol/OXY`),
      fetch(`${base}/api/event-intelligence/sector/Energy`),
      fetch(`${base}/api/event-intelligence/context`),
    ]);
    assert.equal(eventsRes.status, 200);
    assert.equal(latestRes.status, 200);
    assert.equal(symbolRes.status, 200);
    assert.equal(sectorRes.status, 200);
    assert.equal(contextRes.status, 200);
    const context = await contextRes.json();
    assert.ok(context.context.affectedSymbols.includes('OXY'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await stopTestMongo(mongod);
  }
});

test('decision scan records related event context for journal replay', async () => {
  const mods = await loadEventDist();
  const scan = mods.buildDecisionScan({
    now: Date.parse('2026-07-25T14:00:00.000Z'),
    marketStatus: 'open',
    eventContext: [{
      eventId: 'event:test:1',
      title: 'Iran ceasefire sends crude lower',
      category: 'Oil',
      importance: 95,
      sentiment: 0.91,
      triggeredReevaluation: true,
      marketContext: { affectedSymbols: ['OXY'], affectedSectors: ['Energy'] },
      historicalSimilarity: { historicalWinRate: 1 },
    }],
    watchlist: [{ symbol: 'OXY' }],
    chains: { OXY: { underlyingPrice: 60, contracts: [] } },
  });
  assert.equal(scan.relatedEvents.length, 1);
  assert.equal(scan.relatedEvents[0].eventId, 'event:test:1');
});
