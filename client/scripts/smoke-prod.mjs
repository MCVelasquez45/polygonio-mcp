// Production smoke test: every check must reach the Express backend THROUGH
// the Vercel same-origin proxy. Run after each production deploy:
//   node scripts/smoke-prod.mjs [https://production-domain]
const DOMAIN = process.argv[2] ?? 'https://polygonio-mcp-beryl.vercel.app';

// expect: statuses that prove the request traversed Vercel and was answered
// by Express (auth-gated routes may legitimately return 401/403).
const CHECKS = [
  { path: '/api/health', expect: [200] },
  { path: '/api/broker/account', expect: [200, 401, 403] },
  { path: '/api/portfolio/positions', expect: [200, 401, 403] },
  { path: '/api/market/trades/SPY?limit=150', expect: [200, 400, 401, 403] },
  { path: '/socket.io/?EIO=4&transport=polling', expect: [200] },
];

let failed = false;
for (const check of CHECKS) {
  const url = `${DOMAIN}${check.path}`;
  let status = 0;
  let viaVercel = false;
  let detail = '';
  try {
    const res = await fetch(url, { redirect: 'manual' });
    status = res.status;
    viaVercel = res.headers.has('x-vercel-id');
    const body = await res.text();
    // A rewrite regression serves the SPA index.html (or a Vercel NOT_FOUND
    // page) instead of a backend response — treat HTML as a failure.
    if (body.trimStart().startsWith('<')) detail = 'response is HTML, not a backend payload';
  } catch (error) {
    detail = String(error);
  }
  const ok = check.expect.includes(status) && viaVercel && !detail;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${status}  ${check.path}${detail ? `  (${detail})` : ''}`);
}

process.exit(failed ? 1 : 0);
