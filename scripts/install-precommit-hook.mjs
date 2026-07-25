import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('.githooks/pre-commit');
const target = resolve('.git/hooks/pre-commit');

if (!existsSync(source) || !existsSync('.git')) {
  process.exit(0);
}

try {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'tooling',
    module: 'precommit',
    event: 'PRECOMMIT_HOOK_INSTALLED',
    target,
  }));
} catch (error) {
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'tooling',
    module: 'precommit',
    event: 'PRECOMMIT_HOOK_INSTALL_SKIPPED',
    reason: error instanceof Error ? error.message : String(error),
  }));
}
