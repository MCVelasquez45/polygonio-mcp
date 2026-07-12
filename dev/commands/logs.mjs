#!/usr/bin/env node
// `npm run logs [service...]` — tail (and by default follow) the unified
// per-service log files under dev/logs/. Lines are prefixed with the colored
// [service] tag, matching the live orchestrator output.
//
//   npm run logs                 all services, follow
//   npm run logs backend         just backend, follow
//   npm run logs -- --lines=200  show more history
//   npm run logs -- --no-follow  print history and exit

import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { logDir } from '../lib/runtime.mjs';
import { color, dim } from '../lib/colors.mjs';

const args = process.argv.slice(2);
const follow = !args.includes('--no-follow');
const linesArg = args.find((a) => a.startsWith('--lines='));
const historyLines = linesArg ? Number(linesArg.slice(8)) : 50;
const wanted = args.filter((a) => !a.startsWith('--'));

const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);
const dir = logDir(REPO_ROOT);

const selected = services.filter((s) => (wanted.length ? wanted.includes(s.name) || wanted.includes(s.id) : true));
if (selected.length === 0) {
  process.stderr.write(`No services match: ${wanted.join(', ')}\n`);
  process.exit(1);
}
const width = Math.max(...selected.map((s) => s.name.length));
const prefixOf = (s) => color(s.color, `[${s.name.padEnd(width)}]`);

function tailString(text, n) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n);
}

const offsets = new Map();

for (const s of selected) {
  const file = path.join(dir, `${s.name}.log`);
  if (!fs.existsSync(file)) {
    process.stdout.write(`${prefixOf(s)} ${dim('(no log yet)')}\n`);
    offsets.set(s.name, 0);
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  for (const line of tailString(content, historyLines)) {
    process.stdout.write(`${prefixOf(s)} ${line}\n`);
  }
  offsets.set(s.name, Buffer.byteLength(content));
}

if (!follow) process.exit(0);

process.stdout.write(dim('\n— following (Ctrl+C to stop) —\n'));

const poll = () => {
  for (const s of selected) {
    const file = path.join(dir, `${s.name}.log`);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const prev = offsets.get(s.name) ?? 0;
    if (stat.size < prev) {
      // File truncated/rotated — restart from the beginning.
      offsets.set(s.name, 0);
      continue;
    }
    if (stat.size > prev) {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(stat.size - prev);
      fs.readSync(fd, buf, 0, buf.length, prev);
      fs.closeSync(fd);
      offsets.set(s.name, stat.size);
      for (const line of tailString(buf.toString('utf8'), Infinity)) {
        process.stdout.write(`${prefixOf(s)} ${line}\n`);
      }
    }
  }
};

setInterval(poll, 400);
