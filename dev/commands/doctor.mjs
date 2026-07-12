#!/usr/bin/env node
// `npm run doctor` — validate the whole development environment: toolchain,
// credentials/config, database connectivity, required ports, and service
// endpoints. Reports every problem clearly; exits non-zero on hard failures.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadRegistry } from '../lib/manifest.mjs';
import { REGISTRY_PATH, REPO_ROOT } from '../lib/paths.mjs';
import { loadServiceEnv, parseEnvFile } from '../lib/env.mjs';
import { probeHttp, findPortProcesses } from '../lib/net.mjs';
import { color, bold, dim } from '../lib/colors.mjs';

const require = createRequire(import.meta.url);
const { services } = loadRegistry(REGISTRY_PATH, REPO_ROOT);

const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';
const counts = { ok: 0, warn: 0, fail: 0 };

function line(status, label, detail = '') {
  counts[status] += 1;
  const icon = status === OK ? color('green', '✓') : status === WARN ? color('yellow', '⚠') : color('brightRed', '✗');
  process.stdout.write(`  ${icon} ${label}${detail ? '  ' + dim(detail) : ''}\n`);
}
function section(title) {
  process.stdout.write(`\n${bold(title)}\n`);
}

function cmdVersion(cmd, args = ['--version']) {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0];
  } catch {
    return null;
  }
}

// ── Toolchain ────────────────────────────────────────────────────────────────
section('Toolchain');
{
  const major = Number(process.version.slice(1).split('.')[0]);
  line(major >= 20 ? OK : FAIL, `Node ${process.version}`, major >= 20 ? '' : 'need >= 20');

  const npm = cmdVersion('npm');
  line(npm ? OK : FAIL, npm ? `npm ${npm}` : 'npm not found');

  const py = cmdVersion('python3') || cmdVersion('python');
  line(py ? OK : FAIL, py ? py : 'python3 not found', py ? '' : 'required for MCP + screener');

  const uv = cmdVersion('uv');
  line(uv ? OK : FAIL, uv ? uv : 'uv not found', uv ? '' : 'required to run Python services');
}

// ── Credentials & configuration ───────────────────────────────────────────────
section('Credentials & configuration');
const serverEnv = parseEnvFile(path.join(REPO_ROOT, 'server', '.env')) || {};
{
  const present = (v) => typeof v === 'string' && v.trim().length > 0;

  // OpenAI
  const oa = serverEnv.OPENAI_API_KEY;
  if (!present(oa)) line(FAIL, 'OpenAI API key', 'OPENAI_API_KEY missing in server/.env');
  else line(oa.startsWith('sk-') ? OK : WARN, 'OpenAI API key', oa.startsWith('sk-') ? 'present' : 'present but unexpected format');

  // Polygon / Massive
  const poly = serverEnv.MASSIVE_API_KEY || serverEnv.POLYGON_API_KEY;
  line(present(poly) ? OK : FAIL, 'Polygon/Massive API key', present(poly) ? 'present' : 'MASSIVE_API_KEY missing');

  // Alpaca
  const alpacaOk = present(serverEnv.APCA_API_KEY_ID) && present(serverEnv.APCA_API_SECRET_KEY);
  line(alpacaOk ? OK : FAIL, 'Alpaca keys', alpacaOk ? 'key id + secret present' : 'APCA_API_KEY_ID / APCA_API_SECRET_KEY missing');

  // Per-service required env (from the registry).
  for (const s of services) {
    if (!s.requiredEnv.length) continue;
    const env = loadServiceEnv(REPO_ROOT, s.envFile);
    if (env === null) {
      line(s.enabled ? WARN : OK, `${s.displayName} env`, `${s.envFile || 'env file'} not found`);
      continue;
    }
    const missing = s.requiredEnv.filter((k) => !present(env[k]));
    if (missing.length === 0) line(OK, `${s.displayName} env`, `${s.requiredEnv.length} required vars present`);
    else line(FAIL, `${s.displayName} env`, `missing: ${missing.join(', ')}`);
  }
}

// ── Database ───────────────────────────────────────────────────────────────────
section('Database (MongoDB Atlas)');
{
  const uri = serverEnv.MONGO_URI || serverEnv.MONGODB_URI;
  if (!uri) {
    line(FAIL, 'MONGO_URI', 'missing in server/.env');
  } else {
    const host = (() => {
      try {
        return new URL(uri).host;
      } catch {
        return 'unknown-host';
      }
    })();
    line(OK, 'MONGO_URI', `configured → ${host}`);
    try {
      const { MongoClient } = require(path.join(REPO_ROOT, 'server', 'node_modules', 'mongodb'));
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
      await client.connect();
      await client.db('admin').command({ ping: 1 });
      await client.close();
      line(OK, 'Atlas connectivity', 'authenticated + ping ok');
    } catch (err) {
      line(FAIL, 'Atlas connectivity', String(err.message || err).split('\n')[0]);
    }
  }
}

// ── Ports ────────────────────────────────────────────────────────────────────
section('Ports');
for (const s of services) {
  if (!s.enabled || s.port == null) continue;
  const procs = await findPortProcesses(s.port);
  if (procs.length === 0) line(OK, `:${s.port}`, `free (${s.displayName})`);
  else line(WARN, `:${s.port}`, `in use by ${procs.map((p) => `${p.command}#${p.pid}`).join(', ')} (${s.displayName})`);
}

// ── Endpoints ──────────────────────────────────────────────────────────────────
section('Service endpoints (informational)');
for (const s of services) {
  if (!s.enabled || s.health?.type !== 'http') continue;
  const up = await probeHttp(s.health.url, s.health.expect);
  line(up ? OK : WARN, s.displayName, up ? `reachable ${s.health.url}` : 'not running');
}

// ── Summary ────────────────────────────────────────────────────────────────────
process.stdout.write(
  `\n${bold('Summary')}  ${color('green', counts.ok + ' ok')}  ${color('yellow', counts.warn + ' warn')}  ${color('brightRed', counts.fail + ' fail')}\n\n`
);
if (counts.fail > 0) {
  process.stdout.write(color('brightRed', 'Environment has problems that will block services. See ✗ items above.\n\n'));
  process.exit(1);
}
process.stdout.write(color('green', 'Environment looks good.\n\n'));
