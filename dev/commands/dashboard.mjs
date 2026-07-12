#!/usr/bin/env node
// `npm run dashboard` — live, auto-refreshing view of the dev environment:
// per-service state, health, port, restart count, CPU, memory, and uptime.
// Reads the orchestrator's runtime state and augments it with live probes.

import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { readState, isAlive } from '../lib/runtime.mjs';
import { probeService, listenerPid, sampleProcesses, formatUptime } from '../lib/probe.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const REFRESH_MS = Number(process.env.DASH_REFRESH_MS || 2000);
const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);
const enabled = services.filter((s) => s.enabled);
const width = Math.max(...enabled.map((s) => s.displayName.length), 'SERVICE'.length);

const ICON = {
  healthy: color('green', '✓'),
  skipped: color('green', '✓'),
  starting: color('yellow', '…'),
  restarting: color('yellow', '⟳'),
  unhealthy: color('yellow', '!'),
  failed: color('brightRed', '✗'),
  blocked: color('brightRed', '⊘'),
  stopped: dim('■'),
  down: color('brightRed', '✗'),
  unknown: dim('○'),
};

let stopped = false;

async function render() {
  const state = readState(REPO_ROOT);
  const orchLive = state && isAlive(state.orchestratorPid);

  // Scope to the orchestrator's active profile when one is running.
  const activeIds = orchLive ? new Set(Object.keys(state.services)) : null;
  const visible = enabled.filter((s) => (activeIds ? activeIds.has(s.id) : true));

  // Gather per-service info concurrently.
  const rows = await Promise.all(
    visible.map(async (s) => {
      const rec = state?.services?.[s.id];
      const health = await probeService(s);
      const pid = rec?.pid && isAlive(rec.pid) ? rec.pid : await listenerPid(s.port);
      return { s, rec, health, pid };
    })
  );
  const stats = await sampleProcesses(rows.map((r) => r.pid));

  const out = [];
  out.push('\x1b[2J\x1b[H'); // clear + home
  out.push(bold('  AI-Trader Development Environment') + '\n');
  const meta = orchLive
    ? dim(`  orchestrator pid ${state.orchestratorPid} · profile "${state.profile}" · up ${formatUptime(state.startedAt)}`)
    : dim('  orchestrator: not running (live probes only)');
  out.push(meta + `   ${dim(new Date().toLocaleTimeString())}\n\n`);

  out.push(
    dim(`  ${'SERVICE'.padEnd(width)}  STATE       HEALTH  PORT   REST  CPU%   MEM      UPTIME`) + '\n'
  );

  for (const { s, rec, health, pid } of rows) {
    const st = rec?.state || (health === true ? 'healthy' : health === false ? 'down' : 'unknown');
    const icon = ICON[st] || ICON.unknown;
    // Pad the plain text to a fixed width first, THEN colorize (so ANSI codes
    // don't throw off column alignment).
    const hText = (health === true ? 'up' : health === false ? 'down' : '—').padEnd(4);
    const hCell = health === true ? color('green', hText) : health === false ? color('brightRed', hText) : dim(hText);
    const port = s.port ? String(s.port) : '—';
    const rest = rec ? String(rec.restarts) : '—';
    const ps = pid ? stats.get(pid) : null;
    const cpu = ps ? ps.cpu.toFixed(1) : '—';
    const mem = ps ? `${ps.rssMb.toFixed(0)}MB` : '—';
    const uptime = rec?.startedAt && pid ? formatUptime(rec.startedAt) : '—';
    out.push(
      `  ${icon} ${color(s.color, s.displayName.padEnd(width))}  ${st.padEnd(10)}  ${hCell}  ${port.padEnd(6)} ${rest.padEnd(5)} ${String(cpu).padEnd(6)} ${mem.padEnd(8)} ${uptime}\n`
    );
  }

  const failed = rows.filter((r) => r.rec?.state === 'failed' || r.rec?.state === 'blocked');
  if (failed.length) {
    out.push('\n' + color('brightRed', `  ⚠ ${failed.length} service(s) failed/blocked — see: npm run logs\n`));
  }
  out.push(dim(`\n  refresh ${REFRESH_MS}ms · Ctrl+C to exit\n`));
  process.stdout.write(out.join(''));
}

async function loop() {
  while (!stopped) {
    await render();
    await new Promise((r) => setTimeout(r, REFRESH_MS));
  }
}

process.on('SIGINT', () => {
  stopped = true;
  process.stdout.write('\x1b[?25h\n'); // show cursor
  process.exit(0);
});

process.stdout.write('\x1b[?25l'); // hide cursor
loop();
