// Post-build guard: the production bundle must never contain the backend
// origin. All browser traffic goes to /api/* on the frontend origin and the
// Vercel rewrites proxy it, so any backend hostname in dist/ means a
// regression (hardcoded URL or a VITE_* env var injected at build time).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = [/onrender\.com/i, /polygonio-backend/i];
const distDir = new URL('../dist', import.meta.url).pathname;

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
if (offenders.length > 0) {
  console.error('[BUILD GUARD] Backend origin leaked into the frontend bundle:');
  for (const offender of offenders) console.error(`  - ${offender}`);
  console.error('Remove hardcoded backend URLs and unset VITE_API_BASE_URL/VITE_SOCKET_URL in production.');
  process.exit(1);
}
console.log('[BUILD GUARD] OK — no backend origin in the production bundle.');
