// Post-build guard: the production bundle must never contain the backend
// origin. All browser traffic goes to /api/* on the frontend origin and the
// Vercel rewrites proxy it, so any backend hostname in dist/ means a
// regression (hardcoded URL or a VITE_* env var injected at build time).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const FORBIDDEN = [/onrender\.com/i, /polygonio-backend/i, /\blocalhost\b/, /127\.0\.0\.1/];
const distDir = new URL('../dist', import.meta.url).pathname;
const srcDir = new URL('../src', import.meta.url).pathname;

const offenders = [];
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (!/\.(js|css|html|json|map)$/.test(entry.name)) continue;
    const content = readFileSync(path, 'utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(content)) offenders.push(`${path} matches ${pattern}`);
    }
  }
}

scan(distDir);

// Source-level architecture checks: exactly one axios client, exactly one
// Socket.IO call site, and no backend hostname anywhere in client source.
const axiosCreateFiles = [];
const ioCallFiles = [];
function scanSrc(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      scanSrc(path);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
    const content = readFileSync(path, 'utf8');
    const rel = relative(srcDir, path);
    if (content.includes('axios.create(')) axiosCreateFiles.push(rel);
    if (/(?<![\w.])io\(/.test(content)) ioCallFiles.push(rel);
    if (/onrender\.com|polygonio-backend/i.test(content)) offenders.push(`src/${rel} references the backend hostname`);
  }
}
scanSrc(srcDir);
if (axiosCreateFiles.length !== 1 || axiosCreateFiles[0] !== 'api/http.ts') {
  offenders.push(`expected exactly one axios.create() in api/http.ts, found: ${axiosCreateFiles.join(', ') || 'none'}`);
}
if (ioCallFiles.length !== 1 || ioCallFiles[0] !== 'lib/socket.ts') {
  offenders.push(`expected exactly one io() call site in lib/socket.ts, found: ${ioCallFiles.join(', ') || 'none'}`);
}

if (offenders.length > 0) {
  console.error('[BUILD GUARD] Networking architecture violation:');
  for (const offender of offenders) console.error(`  - ${offender}`);
  console.error('All HTTP must flow through api/http.ts and all sockets through lib/socket.ts, with no backend or loopback hostname in the production bundle.');
  process.exit(1);
}
console.log('[BUILD GUARD] OK — single HTTP client, single socket client, no backend/loopback origin in the bundle.');
