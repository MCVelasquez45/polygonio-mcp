#!/usr/bin/env node
// `npm run ports` — show every port the registry reserves and who owns it.

import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { findPortProcesses } from '../lib/net.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);

// Collect every declared port with its owning service.
const rows = [];
for (const s of services) {
  for (const port of s.ports) rows.push({ port, service: s });
}
rows.sort((a, b) => a.port - b.port);

process.stdout.write(`${bold('\nPort status')}\n\n`);
for (const { port, service } of rows) {
  const procs = await findPortProcesses(port);
  const tag = service.enabled ? '' : dim(' (disabled)');
  if (procs.length === 0) {
    process.stdout.write(`  ${String(port).padEnd(6)} ${color('green', '✓ free')}   ${dim(service.displayName)}${tag}\n`);
  } else {
    const who = procs.map((p) => `${p.command}#${p.pid}`).join(', ');
    process.stdout.write(`  ${String(port).padEnd(6)} ${color('yellow', 'busy')}     ${dim(service.displayName)}${tag} ${dim('— ' + who)}\n`);
  }
}
process.stdout.write('\n');
