#!/usr/bin/env node
// `npm run restart` — stop everything, then start the same profile again
// (foreground). The profile is taken from the previous run's runtime state,
// or from `--profile=NAME`, defaulting to "full".

import { spawn } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, DEV_DIR } from '../lib/paths.mjs';
import { readState } from '../lib/runtime.mjs';
import { stopAll } from './stop.mjs';
import { dim, bold } from '../lib/colors.mjs';

const argProfile = process.argv.find((a) => a.startsWith('--profile='))?.slice(10);
const prevProfile = readState(REPO_ROOT)?.profile;
const profile = argProfile || prevProfile || 'full';

await stopAll();

process.stdout.write(`${bold('Restart')} ${dim(`→ profile "${profile}"`)}\n`);

// Re-exec the orchestrator in the foreground so Ctrl+C works as usual.
const child = spawn(process.execPath, [path.join(DEV_DIR, 'dev.mjs'), `--profile=${profile}`], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
