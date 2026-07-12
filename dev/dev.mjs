#!/usr/bin/env node
// Local development orchestrator — entry point.
//
//   npm run dev:all                 start every enabled service
//   node dev/dev.mjs --list         list all services in the manifest
//   node dev/dev.mjs --dry-run      show the start plan + port check, start nothing
//   node dev/dev.mjs --only a,b     start only these services (and their deps)
//   node dev/dev.mjs --except a,b   start everything except these
//   node dev/dev.mjs --on-conflict=reuse|restart|abort|prompt
//   node dev/dev.mjs --no-restart   disable auto-restart of crashed services
//
// See dev/README.md for the full manifest reference and troubleshooting guide.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, topoOrder } from './lib/manifest.mjs';
import { applyProfile } from './lib/profiles.mjs';
import { Orchestrator } from './lib/orchestrator.mjs';
import { color, bold, dim } from './lib/colors.mjs';
import { REGISTRY_PATH, REPO_ROOT } from './lib/paths.mjs';

const MANIFEST = REGISTRY_PATH;

function parseArgs(argv) {
  const opts = {
    list: false,
    dryRun: false,
    profile: null,
    only: null,
    except: null,
    onConflict: 'prompt',
    autoRestart: true,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--list') opts.list = true;
    else if (arg === '--dry-run' || arg === '--plan') opts.dryRun = true;
    else if (arg === '--no-restart') opts.autoRestart = false;
    else if (arg.startsWith('--profile=')) opts.profile = arg.slice(10);
    else if (arg.startsWith('--only=')) opts.only = splitList(arg.slice(7));
    else if (arg.startsWith('--except=')) opts.except = splitList(arg.slice(9));
    else if (arg.startsWith('--on-conflict=')) opts.onConflict = arg.slice(14);
    else {
      console.error(`Unknown argument: ${arg}\nRun with --help for usage.`);
      process.exit(2);
    }
  }
  const valid = ['prompt', 'reuse', 'restart', 'abort'];
  if (!valid.includes(opts.onConflict)) {
    console.error(`--on-conflict must be one of: ${valid.join(', ')}`);
    process.exit(2);
  }
  return opts;
}

const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function printHelp() {
  process.stdout.write(`${bold('Development orchestrator')}

Usage: npm run dev:all [-- <options>]
       node dev/dev.mjs [options]

Options:
  --profile=NAME         Start only the services in a profile (+ their deps).
                         Profiles: core frontend backend mcp workers research
                                   trading analytics full
  --list                 List all services defined in the registry and exit.
  --dry-run, --plan      Show the start order + port check, but start nothing.
  --only=a,b             Start only these services (dependencies are included).
  --except=a,b           Start everything except these services.
  --on-conflict=MODE     prompt (default, if TTY) | reuse | restart | abort
  --no-restart           Do not auto-restart services that exit unexpectedly.
  -h, --help             Show this help.

Registry: dev/registry.yaml   Docs: dev/README.md
`);
}

/** Expand an --only selection to include transitive dependencies. */
function withDeps(services, names) {
  const byName = new Map(services.map((s) => [s.name, s]));
  const keep = new Set();
  const visit = (n) => {
    if (keep.has(n) || !byName.has(n)) return;
    keep.add(n);
    for (const d of byName.get(n).dependsOn) visit(d);
  };
  for (const n of names) {
    if (!byName.has(n)) {
      console.error(`--only: unknown service "${n}"`);
      process.exit(2);
    }
    visit(n);
  }
  return keep;
}

function applySelection(services, opts) {
  let selected = services;
  if (opts.only) {
    const keep = withDeps(services, opts.only);
    selected = services.map((s) => (keep.has(s.name) ? s : { ...s, enabled: false }));
  }
  if (opts.except) {
    const drop = new Set(opts.except);
    selected = selected.map((s) => (drop.has(s.name) ? { ...s, enabled: false } : s));
  }
  return selected;
}

function printList(services) {
  process.stdout.write(`${bold('\nServices')} (from dev/registry.yaml)\n\n`);
  for (const s of topoOrder(services)) {
    const tag = s.enabled ? color('green', 'enabled ') : dim('disabled');
    const dep = s.dependsOn.length ? dim(`  ← ${s.dependsOn.join(', ')}`) : '';
    const port = s.port ? dim(` :${s.port}`) : '';
    process.stdout.write(`  ${tag}  ${color(s.color, s.name)}${port}${dep}\n`);
    process.stdout.write(`            ${dim(`${s.cwdRel} $ ${s.command}`)}\n`);
  }
  process.stdout.write('\n');
}

function printPlan(services) {
  process.stdout.write(`${bold('\nStart plan')} (dependency order)\n\n`);
  const enabled = topoOrder(services).filter((s) => s.enabled);
  enabled.forEach((s, i) => {
    const dep = s.dependsOn.length ? dim(` after [${s.dependsOn.join(', ')}]`) : dim(' (no deps)');
    process.stdout.write(`  ${i + 1}. ${color(s.color, s.name)}${dep}\n`);
  });
  process.stdout.write('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  let services;
  let profiles;
  try {
    ({ services, profiles } = loadRegistry(MANIFEST, REPO_ROOT));
  } catch (err) {
    console.error(color('brightRed', String(err.message || err)));
    process.exit(1);
  }

  if (opts.profile) {
    try {
      services = applyProfile(services, profiles, opts.profile);
    } catch (err) {
      console.error(color('brightRed', String(err.message || err)));
      process.exit(2);
    }
  }

  services = applySelection(services, opts);

  if (opts.list) return printList(services);

  const orch = new Orchestrator(services, {
    repoRoot: REPO_ROOT,
    onConflict: opts.onConflict,
    autoRestart: opts.autoRestart,
    profile: opts.profile || 'full',
  });

  if (opts.dryRun) {
    printPlan(services);
    await orch.resolvePorts();
    orch.logger.say('dry run — nothing started.');
    return;
  }

  // Graceful shutdown wiring — Ctrl+C / SIGTERM stop everything cleanly.
  let shuttingDown = false;
  const onSignal = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write('\n');
    orch.logger.say(`received ${sig}, shutting down…`);
    orch.shutdown().then(() => process.exit(0));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  try {
    const skip = await orch.resolvePorts();
    await orch.start(skip);
  } catch (err) {
    orch.logger.error(String(err.message || err));
    await orch.shutdown();
    process.exit(1);
  }

  if (orch.anyFailed()) {
    orch.logger.warn('some services failed to start — see status above. Logs in dev/logs/.');
  } else {
    orch.logger.say('all services up. Streaming logs — press Ctrl+C to stop everything.');
  }
  // Keep the process alive to stream logs and supervise restarts.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
