// Integration test for health-gated startup ordering. Spawns tiny fixture
// processes so we exercise the real supervisor/health/gating path. Runtime
// state is written under a throwaway temp dir so we never touch dev/.runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRegistry } from '../lib/manifest.mjs';
import { Orchestrator } from '../lib/orchestrator.mjs';
import { writeTempRegistry, cleanup, REPO_ROOT } from './helpers.mjs';

const FIX = 'node dev/test/fixtures/httpserver.cjs';

function tempRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-orch-'));
  fs.mkdirSync(path.join(d, 'dev'), { recursive: true });
  return d;
}

// Silence the orchestrator's console output so it doesn't interleave with the
// test reporter. We mutate (not replace) the logger so supervisors keep their
// reference and state-change routing still works.
function silence(orch) {
  for (const m of ['say', 'line', 'banner', 'warn', 'error', 'dim']) orch.logger[m] = () => {};
}

test('a dependent starts only after its dependency is healthy', async () => {
  const yaml = `
services:
  alpha:
    command: ${FIX} 4772
    port: 4772
    health: { type: http, url: "http://127.0.0.1:4772/", timeoutMs: 8000, intervalMs: 150 }
  beta:
    command: ${FIX} 4773
    port: 4773
    dependsOn: [alpha]
    health: { type: http, url: "http://127.0.0.1:4773/", timeoutMs: 8000, intervalMs: 150 }
`;
  const f = writeTempRegistry(yaml);
  const root = tempRoot();
  const { services } = loadRegistry(f, REPO_ROOT);
  const orch = new Orchestrator(services, { repoRoot: root, onConflict: 'abort', autoRestart: false });
  silence(orch);

  const events = [];
  const orig = orch._onStateChange.bind(orch);
  orch._onStateChange = (svc, next) => {
    events.push({ id: svc.id, next, t: Date.now() });
    orig(svc, next);
  };

  try {
    await orch.start(new Set());
    const alphaHealthy = events.find((e) => e.id === 'alpha' && e.next === 'healthy');
    const betaStarting = events.find((e) => e.id === 'beta' && e.next === 'starting');
    assert.ok(alphaHealthy, 'alpha should become healthy');
    assert.ok(betaStarting, 'beta should start');
    assert.ok(alphaHealthy.t <= betaStarting.t, 'beta must not start until alpha is healthy');
  } finally {
    await orch.shutdown();
    cleanup(f);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a strict dependent is blocked when its dependency never gets healthy', async () => {
  const yaml = `
services:
  alpha:
    command: ${FIX} 4774 idle
    port: 4774
    health: { type: http, url: "http://127.0.0.1:4774/", timeoutMs: 1200, intervalMs: 200 }
  beta:
    command: ${FIX} 4775
    port: 4775
    dependsOn: [alpha]
    dependencyMode: strict
    health: { type: http, url: "http://127.0.0.1:4775/", timeoutMs: 3000, intervalMs: 200 }
`;
  const f = writeTempRegistry(yaml);
  const root = tempRoot();
  const { services } = loadRegistry(f, REPO_ROOT);
  const orch = new Orchestrator(services, { repoRoot: root, onConflict: 'abort', autoRestart: false });
  silence(orch);

  try {
    await orch.start(new Set());
    const beta = orch.supervisors.get('beta');
    assert.equal(beta.state, 'blocked', 'beta should be blocked by unhealthy strict dependency');
  } finally {
    await orch.shutdown();
    cleanup(f);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
