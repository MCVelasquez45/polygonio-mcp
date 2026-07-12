// Shared test helpers: write a temporary registry YAML and return its path.
// cwd defaults to "." so normalizeService's existence check passes against the
// repo root we pass in.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let counter = 0;
export function writeTempRegistry(yamlText) {
  counter += 1;
  const file = path.join(os.tmpdir(), `dev-registry-test-${process.pid}-${counter}.yaml`);
  fs.writeFileSync(file, yamlText);
  return file;
}

export function cleanup(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}
