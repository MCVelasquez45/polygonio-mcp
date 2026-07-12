# Massive Integration — Audit & Gap Report

Source of truth: Massive official docs + MCP (`https://massive.com/docs`,
`https://mcp.massive.com/`). Endpoints were also probed live (`api.massive.com`
returns 200 for the paths below). This report lists what matches, what doesn't,
and a prioritized fix list.

**Status:** the two **P1** issues are ✅ **RESOLVED** (see below) — code fixed,
tested, and validated. **P2/P3** remain as the fix list to work through before
adding more trading features. Scope of P1 changes was limited to the Massive
data-access layer (retry policy + WebSocket host); no trading logic, MongoDB
schemas, GPT prompts, provider abstraction, or business logic were changed.

## Phase 1 — Integration inventory

| Concern | Where | Notes |
| --- | --- | --- |
| REST wrapper | `server/src/shared/data/massive.ts` | `massiveGet()` + caching, request queue, retry, pagination. Used by most option/market features. |
| Second REST path | `server/src/features/marketData/massiveProvider.ts` | `getStockBars`/`getOptionBars`; **its own** axios + retry logic (diverges from `massive.ts`). |
| WebSocket | `server/src/shared/data/massiveWs.ts` | `MassiveWsClient`: auth → subscribe → reconnect. |
| WS wiring | `server/src/features/market/services/liveFeed.ts` | Chooses WS URLs + channels. |
| Python REST | `agent/core/polygon_agent.py`, `agent/core/backtest_executor.py`, `python-screener-service/screener.py` | Direct calls with `POLYGON_API_KEY` (== `MASSIVE_API_KEY`). |
| Endpoints used | — | `/v2/aggs/ticker/{sym}/range/...`, `/v3/trades/{sym}`, `/v3/quotes/{sym}`, `/v3/reference/options/contracts[/{sym}]`, `/v3/reference/exchanges`, `/v3/reference/conditions`, `/v3/snapshot/options/{underlying}`. |
| Auth | `massive.ts:260-267`, `massiveProvider.ts:159-163` | Sends key 3 ways at once: `apiKey` query + `Authorization: Bearer` + `X-API-Key`. |
| Pagination | `massive.ts` `parseMassiveNextUrl`/`extractCursor` | Follows `next_url`, strips + re-adds `apiKey`, caps pages. |
| Retry/rate-limit | `massive.ts:174-195`, `massiveProvider.ts:168-170` | Inconsistent (see P1 below). |

## Phase 2 — Verification against official docs

- ✅ **Endpoints exist / respond.** All paths above are valid Massive REST
  endpoints (categories confirmed in `llms.txt`; live 200s).
- ✅ **Auth via `apiKey` query param works** (verified). Massive is
  Polygon-compatible; the same key authenticates against `api.polygon.io` too.
- ✅ **Pagination model correct** — `next_url` + cursor, key re-appended.
- ⚠️ **Response-shape assumptions** for snapshots/chains are defensive but
  guess across several shapes — should be reconciled with the current
  `/v3/snapshot/options/{underlying}` schema via `call_api`.
- ⚠️ **Auth method is over-specified** (3 mechanisms) — confirm the single
  canonical one and drop the rest.

## Phases 6 & 7 — Bug classification + prioritized gaps

### P1 — Fix before more trading features

1. ✅ **RESOLVED — 429 not retried in the shared wrapper.** `massive.ts`
   `shouldRetry` returned `false` for 429, so rate-limit errors surfaced
   immediately, while `massiveProvider.ts` retried *only* 429 (not 5xx/timeouts).
   Two divergent, each-incomplete retry paths.
   - **Root cause:** incorrect code (explicit `if (status === 429) return false`)
     + duplicated, inconsistent retry logic across the two REST clients.
   - **Fix:** extracted a single authoritative policy in
     `server/src/shared/data/massiveRetry.ts` (`isRetryableMassiveError`,
     `resolveMassiveRetryDelayMs`, `parseRetryAfterMs`) that retries 429 +
     {500,502,503,504} + network timeouts and honors `Retry-After` (falls back to
     exponential backoff). Both `massive.ts` and `massiveProvider.ts` now call it;
     their local retry code was deleted. No duplicate retry logic remains.
   - **Docs basis:** Massive's public docs don't publish a numeric rate-limit
     policy (confirmed via `llms.txt`/`llms-full.txt`), so behavior follows the
     HTTP standard for 429/`Retry-After`. A live burst (80 concurrent) did not
     trip a 429 on the current plan, so the header-honoring path is covered by
     unit + integration tests rather than a live 429.
   - **Validation:** `npm run test:massive` (9/9 pass) incl. a wired
     `massiveGet` test that 429→retry→200; live `GET /api/market/aggs?ticker=AAPL`
     returned real bars through the refactored path; `tsc` clean.

2. ✅ **RESOLVED — Live WebSocket defaulted to the Polygon host.** `liveFeed.ts`
   defaulted to `wss://socket.polygon.io/{options,stocks}` and the env overrides
   were unset, so live data ran over Polygon's socket with a Massive key.
   - **Root cause:** stale default host (config), inconsistent with the
     `massiveWs.ts` class default of `socket.massive.com`.
   - **Fix:** `liveFeed.ts` now defaults to `wss://socket.massive.com/{stocks,
     options}` (env override preserved for compatibility); `server/.env.example`
     WS URLs updated to the Massive host.
   - **Docs/empirical basis:** verified directly against the live endpoints — a
     WS client sending `{action:"auth",params:<key>}` to `socket.massive.com`
     receives `status:connected` then an auth response, confirming the host is
     reachable and the auth/subscription protocol (`{action:subscribe,params:"T.AAPL"}`,
     channels `T/Q/A/AM`) is correct. Massive docs confirm the channel model
     (`WS /stocks/T`, `ev:"T"`).
   - **Validation:** `massive.ws.test.mjs` proves auth→subscribe→reconnect→
     resubscribe against a protocol-accurate mock; full stack restarted healthy.
   - ⚠️ **Remaining (external, not a code defect):** the current `MASSIVE_API_KEY`
     plan returns `auth_failed: "Your plan doesn't include websocket access"` on
     **both** hosts, so live `auth_success` + streaming could not be validated
     end-to-end. Unblock by using a Massive plan that includes WebSocket access.

### P2 — Fix soon

3. **Over-specified auth.** Key sent as query param **and** `Bearer` **and**
   `X-API-Key` (`massive.ts:260-267`, `massiveProvider.ts:159-163`). Harmless
   while one is accepted, but masks which is correct and will hide a future auth
   change. → *Cause: incorrect assumption.* Confirm the canonical method via docs
   and send only that. **Impact: medium** (maintainability / future-proofing).

4. **Snapshot/chain response-shape guessing.** `fetchSnapshotOptions` /
   `extractSnapshotOptions` / `normalizeSnapshotLeg` branch across many possible
   shapes. → *Cause: outdated/uncertain response assumptions.* Capture a current
   response with `call_api`, then tighten the parser to the real schema (keep one
   fallback). **Impact: medium** (silent empty chains when the shape drifts).

### P3 — Nice to have / verify

5. **Two divergent REST clients.** `massive.ts` and `massiveProvider.ts` each
   have their own axios instance + cache. **Retry is now unified** via
   `massiveRetry.ts` (done with P1-1), so the highest-risk divergence is gone.
   Remaining: they still duplicate axios setup/auth/cache — optionally route
   `massiveProvider` through `massiveGet` later. **Impact: low** (maintainability).
   *Do not refactor purely for style.*

6. **Channel-name / param verification.** WS channel prefixes and some query
   params (e.g. `underlying_asset` vs `underlying_ticker`, both sent) should be
   confirmed against current docs. **Impact: low** (redundant params are ignored).

### Matches / leave as-is (do not touch)

- `massiveGet` caching, request de-dupe, request queue, page caps — correct and
  valuable; keep.
- Pagination cursor handling — correct.
- WS auth→`auth_success`→subscribe sequencing and reconnect backoff — correct.
- Aggregate timestamp normalization (`normalizeAggTimestamp`) — correct/defensive.

## How to work these fixes

For each: `search_endpoints` → `call_api` (capture a real response) → confirm
param/response against the `.md` doc → then change code. Do not modify trading
logic, schemas, or prompts while fixing data-provider issues.
