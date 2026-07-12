#!/usr/bin/env node
// `npm run health` — probe every enabled service's health endpoint and report.

import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { readState, isAlive } from '../lib/runtime.mjs';
import { probeService } from '../lib/probe.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);

// Scope to the running orchestrator's active profile when one is up; otherwise
// probe every enabled service (full-stack view).
const state = readState(REPO_ROOT);
const activeIds = state && isAlive(state.orchestratorPid) ? new Set(Object.keys(state.services)) : null;
const enabled = services.filter((s) => (activeIds ? activeIds.has(s.id) : s.enabled));

process.stdout.write(`${bold('\nHealth')}\n\n`);

const results = await Promise.all(
  enabled.map(async (s) => ({ s, ok: await probeService(s) }))
);

let down = 0;
const width = Math.max(...enabled.map((s) => s.displayName.length));
for (const { s, ok } of results) {
  let icon;
  let note = '';
  if (ok === null) {
    icon = dim('○');
    note = dim(s.health.type === 'log' ? '(log-gated, not probeable)' : '(no health check)');
  } else if (ok) {
    icon = color('green', '✓');
    note = dim(s.health.type === 'http' ? s.health.url : `:${s.port}`);
  } else {
    icon = color('brightRed', '✗');
    note = color('brightRed', 'unreachable');
    down += 1;
  }
  process.stdout.write(`  ${icon} ${s.displayName.padEnd(width)}  ${note}\n`);
}
process.stdout.write('\n');
process.exit(down > 0 ? 1 : 0);
