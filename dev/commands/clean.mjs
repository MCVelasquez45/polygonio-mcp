#!/usr/bin/env node
// `npm run clean` — remove orchestrator runtime artifacts (logs + state).
// Never touches source, node_modules, or build output unless --dist is passed.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/paths.mjs';
import { runtimeDir, logDir, orchestratorRunning } from '../lib/runtime.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const withDist = process.argv.includes('--dist');

if (orchestratorRunning(REPO_ROOT)) {
  process.stderr.write(
    color('yellow', 'An orchestrator appears to be running. Run `npm run stop` first.\n')
  );
  process.exit(1);
}

const targets = [logDir(REPO_ROOT), runtimeDir(REPO_ROOT)];
if (withDist) {
  targets.push(path.join(REPO_ROOT, 'server', 'dist'), path.join(REPO_ROOT, 'client', 'dist'));
}

process.stdout.write(`${bold('\nClean')}\n\n`);
for (const t of targets) {
  const rel = path.relative(REPO_ROOT, t);
  if (fs.existsSync(t)) {
    fs.rmSync(t, { recursive: true, force: true });
    process.stdout.write(`  ${color('green', 'removed')} ${rel}\n`);
  } else {
    process.stdout.write(`  ${dim('absent ')} ${dim(rel)}\n`);
  }
}
process.stdout.write('\n');
