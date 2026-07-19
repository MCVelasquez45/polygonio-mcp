#!/usr/bin/env node
// `npm run status` — one-shot snapshot of the dev environment. Merges the
// orchestrator's runtime state (if running) with live health + port probes, so
// it is useful whether or not services were started via `npm run dev`.

import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { readState, isAlive } from '../lib/runtime.mjs';
import { probeService, listenerPid, formatUptime } from '../lib/probe.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);
const state = readState(REPO_ROOT);
const orchLive = state && isAlive(state.orchestratorPid);

process.stdout.write(`${bold('\nAI-Trader Development Environment')}\n`);
if (orchLive) {
  process.stdout.write(
    dim(`  orchestrator pid ${state.orchestratorPid} · profile "${state.profile}" · up ${formatUptime(state.startedAt)}\n\n`)
  );
} else {
  process.stdout.write(dim('  orchestrator: not running (showing live probes)\n\n'));
}

// When an orchestrator is running, show exactly the services in its active
// profile; otherwise fall back to all enabled services (live-probe mode).
const activeIds = orchLive ? new Set(Object.keys(state.services)) : null;
const enabled = services.filter((s) => (activeIds ? activeIds.has(s.id) : s.enabled));
const rows = await Promise.all(
  enabled.map(async (s) => {
    const rec = state?.services?.[s.id];
    const health = await probeService(s);
    const pid = rec?.pid && isAlive(rec.pid) ? rec.pid : await listenerPid(s.port);
    return { s, rec, health, pid };
  })
);

const width = Math.max(...enabled.map((s) => s.displayName.length));
const headerState = orchLive ? 'STATE' : 'HEALTH';
process.stdout.write(dim(`  ${'SERVICE'.padEnd(width)}   ${headerState.padEnd(10)} PORT    RESTARTS  UPTIME\n`));

for (const { s, rec, health, pid } of rows) {
  const stateLabel = rec?.state || (health === true ? 'healthy' : health === false ? 'down' : 'unknown');
  const healthy = health === true || stateLabel === 'healthy' || stateLabel === 'skipped';
  const icon = healthy ? color('green', '✓') : health === false ? color('brightRed', '✗') : dim('○');
  const port = s.port ? String(s.port) : '—';
  const restarts = rec ? String(rec.restarts) : '—';
  const uptime = rec?.startedAt && pid ? formatUptime(rec.startedAt) : '—';
  process.stdout.write(
    `  ${icon} ${color(s.color, s.displayName.padEnd(width))} ${stateLabel.padEnd(10)} ${port.padEnd(7)} ${restarts.padEnd(9)} ${uptime}\n`
  );
}
process.stdout.write(dim('\n  Tip: `npm run dashboard` for a live view.\n\n'));
