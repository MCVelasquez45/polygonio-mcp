#!/usr/bin/env node
// `npm run stop` — stop everything cleanly.
//
// Preferred path: signal the running orchestrator, which group-kills each
// child and clears its runtime state. Fallback (no orchestrator, e.g. services
// were started by hand): kill the process group holding each registry port.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { readState, isAlive, clearState } from '../lib/runtime.mjs';
import { findPortProcesses } from '../lib/net.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pgidOf(pid) {
  try {
    return Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)]).toString().trim());
  } catch {
    return null;
  }
}

function killGroup(pid, signal) {
  const pgid = pgidOf(pid);
  try {
    if (pgid) process.kill(-pgid, signal);
    else process.kill(pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export async function stopAll({ quiet = false } = {}) {
  const log = (m) => !quiet && process.stdout.write(m);
  log(`${bold('\nStop')}\n\n`);

  const state = readState(REPO_ROOT);

  // Preferred: graceful shutdown via the orchestrator.
  if (state && isAlive(state.orchestratorPid)) {
    log(`  signalling orchestrator (pid ${state.orchestratorPid})…\n`);
    try {
      process.kill(state.orchestratorPid, 'SIGTERM');
    } catch {
      /* fall through to port-based cleanup */
    }
    for (let i = 0; i < 100; i++) {
      if (!isAlive(state.orchestratorPid)) break;
      await sleep(100);
    }
    if (isAlive(state.orchestratorPid)) {
      log(color('yellow', '  orchestrator did not exit in time; killing group\n'));
      killGroup(state.orchestratorPid, 'SIGKILL');
    }
    clearState(REPO_ROOT);
    log(color('green', '  stopped.\n\n'));
    return;
  }

  // Fallback: kill whatever holds each declared port.
  const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);
  let killed = 0;
  for (const s of services) {
    if (!s.enabled || s.port == null) continue;
    const procs = await findPortProcesses(s.port);
    for (const p of procs) {
      const ok = killGroup(p.pid, 'SIGTERM');
      if (ok) {
        killed += 1;
        log(`  ${color('green', 'killed')} ${s.displayName} ${dim(`(${p.command}#${p.pid} on :${s.port})`)}\n`);
      }
    }
  }
  clearState(REPO_ROOT);
  if (killed === 0) log(dim('  nothing was running.\n'));
  log('\n');
}

// Run when invoked directly (not when imported by restart.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await stopAll();
}
