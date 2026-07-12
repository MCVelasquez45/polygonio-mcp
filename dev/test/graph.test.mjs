import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, topoOrder, startupWaves, toMermaid } from '../lib/manifest.mjs';
import { writeTempRegistry, cleanup, REPO_ROOT } from './helpers.mjs';

const FIXTURE = `
services:
  mcp:      { command: echo mcp, category: mcp, port: 5001 }
  backend:  { command: echo be, category: backend, port: 4000, dependsOn: [mcp] }
  frontend: { command: echo fe, category: frontend, port: 5173, dependsOn: [backend] }
  worker:   { command: echo w, category: worker, dependsOn: [backend] }
`;

function fixtureServices() {
  const f = writeTempRegistry(FIXTURE);
  try {
    return loadRegistry(f, REPO_ROOT).services;
  } finally {
    cleanup(f);
  }
}

test('topoOrder places dependencies before dependents', () => {
  const order = topoOrder(fixtureServices()).map((s) => s.id);
  assert.ok(order.indexOf('mcp') < order.indexOf('backend'));
  assert.ok(order.indexOf('backend') < order.indexOf('frontend'));
  assert.ok(order.indexOf('backend') < order.indexOf('worker'));
});

test('startupWaves groups by dependency depth', () => {
  const waves = startupWaves(fixtureServices()).map((w) => w.map((s) => s.id));
  assert.deepEqual(waves[0], ['mcp']);
  assert.deepEqual(waves[1], ['backend']);
  // frontend and worker both depend only on backend → same wave
  assert.deepEqual(new Set(waves[2]), new Set(['frontend', 'worker']));
});

test('mermaid output contains nodes and edges', () => {
  const m = toMermaid(fixtureServices());
  assert.match(m, /flowchart TD/);
  assert.match(m, /mcp --> backend/);
  assert.match(m, /backend --> frontend/);
});
