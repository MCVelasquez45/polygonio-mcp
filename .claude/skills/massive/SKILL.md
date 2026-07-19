---
name: massive
description: >-
  Development guidance for the Massive market-data API (Polygon-compatible REST +
  WebSocket) used by this repo. Use when writing or debugging Massive/market-data
  integration code — aggregates, quotes, trades, option chains, snapshots,
  WebSocket feeds, pagination, retries, corporate actions. Covers adjusted vs
  unadjusted prices, ticker/options-symbol handling, market sessions, rate limits,
  and common mistakes. Rule #1: verify endpoints against the Massive MCP / llms.txt,
  never guess.
---

# Massive market-data development guide

Massive (`https://api.massive.com`, `wss://socket.massive.com`) is a
**Polygon-compatible** market-data API. This guidance is for AI-assisted
development — it is not runtime code.

## Rule #1 — verify, don't guess

Before writing or changing any Massive call:

1. Use the **Massive MCP** (`.mcp.json`, server `massive`): `search_endpoints`
   to find the endpoint, then `call_api` to see a **real** response shape.
2. Or read the endpoint's Markdown doc: append `.md` to its docs URL (e.g.
   `https://massive.com/docs/rest/stocks/aggregates.md`), or the section
   `llms-full.txt` (`https://massive.com/docs/rest/llms-full.txt`).

If you cannot confirm a parameter name, default, or response field from the MCP
or docs, **say so** — do not invent it. Stale assumptions are the root cause of
the bugs this skill exists to prevent.

## Repo conventions

- All REST goes through `massiveGet(path, params, { cacheTtlMs })` in
  `server/src/shared/data/massive.ts`. Reuse it — it centralizes auth, caching,
  request de-duping, the request queue, and retries. Don't call axios directly.
- WebSockets go through `MassiveWsClient` in `server/src/shared/data/massiveWs.ts`.
- Credential: `MASSIVE_API_KEY` (Node) / `POLYGON_API_KEY` (Python) — same value.

## Auth

- REST accepts the key as an `apiKey` **query parameter** (verified working).
  The repo currently also sends `Authorization: Bearer` and `X-API-Key` headers;
  prefer the single documented method and confirm which one Massive canonically
  expects via the docs before "cleaning this up."
- WebSocket: after the socket opens, send `{ "action": "auth", "params": "<KEY>" }`,
  then wait for a `{ ev: "status", status: "auth_success" }` message **before**
  subscribing. The repo's client already sequences this correctly.
- The **MCP** uses OAuth, not the API key — different auth path entirely.

## Adjusted vs. unadjusted prices

- Aggregates take an `adjusted` boolean. The repo defaults `adjusted: true`
  (split/dividend-adjusted). Use `adjusted: false` only when you specifically
  need raw prices (e.g. reconciling against a broker's unadjusted feed).
- Never mix adjusted and unadjusted series in the same chart/backtest. Corporate
  actions (splits) create large artificial gaps in unadjusted data.

## Ticker & options-symbol handling

- Uppercase tickers before sending (the repo does `.toUpperCase()`).
- Options use OCC-style symbols (e.g. `O:SPY241220C00500000` =
  underlying + `YYMMDD` + `C`/`P` + strike×1000 padded to 8 digits). Confirm the
  exact prefix/format via `call_api` on the reference-contracts endpoint rather
  than hand-building symbols.
- Reference metadata: `/v3/reference/options/contracts/{optionSymbol}` (single)
  and `/v3/reference/options/contracts` (list, filter by `underlying_ticker`).

## Pagination

- List/snapshot endpoints return `next_url`. Follow it until absent.
- **`next_url` does not include your API key** — you must re-append it. The repo
  handles this in `parseMassiveNextUrl` (it strips any `apiKey` and re-adds it on
  the next request). Reuse that helper; don't fetch `next_url` raw.
- Cursor lives inside `next_url`; extract with the existing `extractCursor`/
  `parseMassiveNextUrl` utilities rather than parsing by hand.
- Always cap pages (the repo uses `MASSIVE_*_MAX_PAGES`) so a runaway cursor
  can't hammer the API.

## Market sessions & status

- Use `/v3/reference/market-status` (and market-holidays) to decide open/closed
  rather than inferring from timestamps. Aggregate `adjusted`/session semantics
  differ pre-market vs regular vs after-hours — confirm the session flag on the
  aggregates endpoint via docs before assuming bars include extended hours.

## Corporate actions & historical data

- Splits/dividends are separate reference endpoints (stocks corporate-actions).
  For historical analysis prefer adjusted aggregates; if you need to apply
  actions yourself, pull them explicitly — don't assume they're embedded in the
  aggregate response.
- Aggregate timestamps are epoch **milliseconds** (`t`). The repo normalizes
  seconds→ms defensively (`normalizeAggTimestamp`); keep that when adding fields.

## WebSocket subscriptions

- URL is per asset class: `wss://socket.massive.com/{stocks|options|...}`.
  ⚠️ The repo's env defaults (`MASSIVE_STOCKS_WS_URL`/`MASSIVE_OPTIONS_WS_URL`)
  currently fall back to `socket.polygon.io`, while the client class defaults to
  `socket.massive.com`. Set the env explicitly to avoid connecting to the wrong
  host with a Massive key. (Tracked in the gap report.)
- Subscribe with `{ action: "subscribe", params: "T.AAPL,Q.AAPL" }` — channel
  prefixes (`T` trades, `Q` quotes, `A`/`AM` aggregates) must match Massive's
  documented channels for that asset class. Verify channel names via docs.
- Re-subscribe after every reconnect (the client does this on `auth_success`).

## Rate limits & retries

- Expect HTTP **429** when rate-limited, typically with a `Retry-After` header —
  honor it. ⚠️ The repo's `shouldRetry` currently **excludes 429** (it retries
  500/502/503/504 and timeouts only), so rate-limit errors surface immediately
  even though `parseRetryAfter` exists. When touching this path, make 429 retry
  and respect `Retry-After`. (Tracked in the gap report.)
- The repo throttles outbound requests via a queue (`MASSIVE_MAX_CONCURRENT`,
  `MASSIVE_MIN_INTERVAL_MS`). Prefer raising those over adding ad-hoc sleeps.

## Common API mistakes (seen in this codebase / class of bug)

1. **Assuming a response shape.** Snapshot/chain responses vary
   (`results[0].options` vs `.contracts` vs flat). Always `call_api` first and
   parse defensively.
2. **Dropping the key from `next_url`.** Causes 401 mid-pagination.
3. **Not retrying 429.** Looks like a "flaky Massive" bug; it's a missing retry.
4. **Wrong WS host.** A Massive key against `socket.polygon.io` fails auth.
5. **Building option symbols by hand.** Off-by-one in the strike padding →
   404s. Fetch the contract from reference instead.
6. **Guessing params from another provider's docs.** Massive is
   Polygon-compatible but confirm each param against Massive's own docs/MCP.

When in doubt: `search_endpoints` → `call_api` → then code.
