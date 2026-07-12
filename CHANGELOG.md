# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/), and this project aims
to follow [Semantic Versioning](https://semver.org/).

## [Unreleased] — Development Platform Complete

Infrastructure hardening sprint series completed before AI-Trader feature
development. Focus: reproducible local environment, accurate Massive integration,
and a clean, synchronized repository.

### Added
- **Development platform** (`dev/`): registry-driven orchestrator with one-command
  startup (`npm run dev`, profile variants `dev:core`/`dev:backend`/`dev:mcp`/…),
  health-gated dependency ordering, port-conflict handling, auto-restart, unified
  color-coded logs, a live dashboard, and control commands (`doctor`, `status`,
  `logs`, `health`, `ports`, `graph`, `clean`, `stop`, `restart`).
- **Massive MCP integration**: repository `.mcp.json` pointing at the official
  remote Massive MCP server, plus the `/massive` AI development skill and
  `CLAUDE.md` project instructions.
- **Role-based access control**: `server/src/shared/auth` (JWT + dev-token
  verification, `requireAdmin`/`requireTrader` guards, socket authentication) and
  client-side bearer-token wiring.
- **Paper-trading runtimes**: Alpaca/options/futures paper-trading runtime
  services and supporting dashboard UI.
- Single authoritative Massive retry policy (`server/src/shared/data/massiveRetry.ts`).

### Changed
- Massive live WebSocket now defaults to `wss://socket.massive.com` (was the
  Polygon host); env override preserved.
- Backend startup fails fast on port conflicts via a `predev` guard; the stale
  `nodemon` config/dependency was removed in favor of `ts-node-dev`.
- Screener pinned to Python 3.12 via `.python-version`.
- `.env.example` files aligned to the discovered schema (auth, Massive, Alpaca,
  OpenAI); placeholders only.

### Fixed
- **Massive HTTP 429 handling** (Gap Report P1-1): the shared REST wrapper no
  longer drops rate-limit errors; 429 is retried honoring `Retry-After`, unified
  with the aggregates provider so retry logic is no longer duplicated or divergent.
- **Massive WebSocket host** (Gap Report P1-2): live feed no longer defaults to a
  Polygon endpoint while using a Massive credential.
- Deprecated Mongoose `findOneAndUpdate({ new: true })` replaced with
  `{ returnDocument: 'after' }`.

### Documentation
- `docs/massive/README.md` (developer workflow) and `docs/massive/GAP_REPORT.md`
  (endpoint audit + prioritized fix list; P1 marked resolved).
- `dev/README.md` developer guide and generated `dev/GRAPH.md` dependency diagram.
- `docs/SECURITY_ROTATION_REQUIRED.md` credential rotation policy.

### Testing
- Massive regression tests: 429/Retry-After/backoff, a wired `massiveGet`
  429→retry→200 path, and the WebSocket auth→subscribe→reconnect→resubscribe
  lifecycle (`npm run test:massive`).
- Development-platform tests: registry validation, dependency graph/toposort,
  profile resolution, health checks, port-conflict detection, startup ordering
  (`npm run test:dev`).
