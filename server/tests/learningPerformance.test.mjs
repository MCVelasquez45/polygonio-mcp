import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

test('learning and performance endpoints expose read-only empty-state datasets', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());
  const { intelligenceRouter } = await import('../dist/features/intelligence/intelligence.routes.js');
  const app = express();
  app.use('/api/intelligence', intelligenceRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/intelligence`;
  const paths = [
    '/learning/trade-review',
    '/learning/confidence-calibration',
    '/learning/strategy-scorecards',
    '/learning/dataset',
    '/performance/historical',
    '/performance/market-regime',
    '/performance/event',
    '/performance/sector',
    '/performance/fed',
    '/performance/options-flow',
  ];
  for (const path of paths) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    const payload = await response.json();
    assert.equal(typeof payload.generatedAt, 'string', path);
  }
});

