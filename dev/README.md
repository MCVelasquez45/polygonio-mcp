# AI-Trader Developer Platform

The permanent local development platform for AI-Trader: a registry-driven
service orchestrator plus a suite of control commands. One registry entry per
service; everything else — startup ordering, health checks, ports, logs,
restarts, dashboards, validation — is derived from it. Designed to scale to the
project's eventual ~33 services with no architectural changes.

```bash
npm run dev            # start the full stack
npm run dev:core       # just backend + frontend + mcp
npm run doctor         # validate the environment
npm run dashboard      # live status dashboard
npm run stop           # stop everything cleanly
```

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Service Registry](#2-service-registry)
3. [Adding a service](#3-adding-a-service)
4. [Profiles](#4-profiles)
5. [Commands](#5-commands)
6. [Health checks](#6-health-checks)
7. [Port management](#7-port-management)
8. [Startup sequence](#8-startup-sequence)
9. [Shutdown sequence](#9-shutdown-sequence)
10. [Development workflow](#10-development-workflow)
11. [Testing](#11-testing)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Architecture

The platform is **pure Node.js** (the one runtime the repo already requires) with
a single dependency, `js-yaml`. It runs identically on macOS, Linux, and Windows.

```
  entry points                        control commands (read-only + lifecycle)
  ┌──────────────┐   ┌──────────────────────────────────────────────────────┐
  │ npm run dev  │   │ doctor  status  dashboard  logs  health  ports  graph │
  │ (dev/dev.mjs)│   │ clean   stop    restart                               │
  └──────┬───────┘   └───────────────────────┬──────────────────────────────┘
         │                                    │
         ▼                                    ▼
  ┌────────────────────────┐          ┌───────────────────────┐
  │  lib/orchestrator.mjs   │◀────────▶│  dev/.runtime/state.json  (IPC)  │
  │  ordering · gating ·    │  writes  └───────────────────────┘
  │  conflicts · shutdown   │  state          ▲ read by status/dashboard/stop
  └───────┬─────────────────┘
          │ one Supervisor per service (own process group)
          ▼
  ┌───────────────────┐   reads   ┌────────────────────────────────┐
  │ lib/supervisor.mjs │◀─────────│ dev/registry.yaml  (source of truth) │
  │ spawn·log·health· │           └────────────────────────────────┘
  │ restart·group-kill │                     │ loaded + validated by
  └───────────────────┘                      ▼  lib/manifest.mjs
                                   lib/profiles.mjs · lib/health.mjs ·
                                   lib/net.mjs · lib/probe.mjs · lib/env.mjs ·
                                   lib/logger.mjs · lib/colors.mjs · lib/runtime.mjs
```

**Module map**

| Module | Responsibility |
| --- | --- |
| `dev/registry.yaml` | The service registry — single source of truth. |
| `dev/dev.mjs` | Orchestrator entry: args, profile selection, signals. |
| `lib/manifest.mjs` | Load/validate the registry; toposort; startup waves; Mermaid. |
| `lib/profiles.mjs` | Resolve a profile → service set (+ transitive deps). |
| `lib/orchestrator.mjs` | Port resolution, health-gated launch, status, shutdown, runtime state. |
| `lib/supervisor.mjs` | One service's lifecycle: spawn, logs, health, auto-restart, group-kill. |
| `lib/health.mjs` / `lib/net.mjs` | Readiness probes (http/tcp/log/none); port ownership. |
| `lib/probe.mjs` | CPU/mem/uptime sampling + health probes for the CLI commands. |
| `lib/runtime.mjs` | Read/write `dev/.runtime/state.json`; liveness checks. |
| `lib/env.mjs` | Parse service `.env` files for `doctor`. |
| `lib/logger.mjs` / `lib/colors.mjs` | Aligned, color-coded log prefixes. |
| `dev/commands/*` | The control commands. |
| `dev/test/*` | `node --test` infrastructure tests. |

---

## 2. Service Registry

`dev/registry.yaml` is the single source of truth. Every field is documented
inline at the top of that file. Each service defines:

| Field | Purpose |
| --- | --- |
| `id` / `displayName` | Identity + human label. |
| `category` | `mcp` · `backend` · `frontend` · `worker` · `analytics` · `realtime`. |
| `description` / `tags` | Docs + profile selectors. |
| `cwd` / `command` | Where and what to run. |
| `port` / `ports` | Ports for conflict detection + tcp health. |
| `priority` | Ordering tie-breaker when there is no dependency edge. |
| `dependsOn` / `dependencyMode` | Ordering + `strict`/`lenient` gating. |
| `env` / `envFile` / `requiredEnv` | Runtime env + `doctor` verification. |
| `health` | `type` (http/tcp/log/none) + url/expect/match/timeouts. |
| `restart` | `policy` (on-failure/always/never) + retries/backoff. |

Validation runs on every load (`npm run graph` or any `dev` command) and fails
fast on: missing command, duplicate ports among enabled services, unknown
dependency, dependency cycle, or a profile referencing an unknown id.

---

## 3. Adding a service

Two steps, no code changes:

1. **Add the folder** (the service's code + its own `.env` if needed).
2. **Add a registry entry** under `services:` in `dev/registry.yaml`.

```yaml
  ingest-worker:
    displayName: Ingest Worker
    category: worker
    description: Consumes the ingestion queue and writes aggregates.
    tags: [workers, trading]
    cwd: server
    command: npm run worker:ingest
    dependsOn: [backend]
    health:
      type: log            # no port → gate on a startup log line
      match: "ingest worker ready"
    restart:
      policy: always
```

Then:

```bash
npm run graph        # validates + shows where it lands in the startup order
npm run dev:workers  # start it (profile picks it up automatically via category)
```

Discovery is automatic: profiles, the dependency graph, health, ports, logs,
status, and the dashboard all pick it up from the registry entry. Nothing else
to wire.

---

## 4. Profiles

A profile is a named selector over the registry. Its matched services **plus
their transitive dependencies** are started; disabled services are excluded.

| Profile | Selects | Command |
| --- | --- | --- |
| `full` | everything enabled | `npm run dev` / `npm run dev:full` |
| `core` | backend + frontend + mcp | `npm run dev:core` |
| `backend` | backend (+ deps) | `npm run dev:backend` |
| `frontend` | frontend (+ deps) | `npm run dev:frontend` |
| `mcp` | the MCP/agent service | `npm run dev:mcp` |
| `workers` | worker-category services | `npm run dev:workers` |
| `research` | `research`-tagged services | `npm run dev:research` |
| `trading` | `trading`-tagged services | `npm run dev:trading` |
| `analytics` | `analytics`-category/tagged | `npm run dev:analytics` |

Selectors are `all`, `ids`, `categories`, and `tags` (match on ANY). Define new
profiles in the `profiles:` block of the registry — no code changes.

---

## 5. Commands

| Command | What it does |
| --- | --- |
| `npm run dev[:profile]` | Start a profile (health-gated, ordered). Ctrl+C stops all. |
| `npm run doctor` | Validate toolchain, credentials, Atlas, ports, endpoints. |
| `npm run status` | One-shot snapshot (profile-scoped when running). |
| `npm run dashboard` | Live auto-refreshing dashboard (state/health/port/restarts/CPU/mem/uptime). |
| `npm run logs [svc]` | Tail + follow unified logs, color-prefixed. `-- --no-follow` for a dump. |
| `npm run health` | Probe every active service's health endpoint (exit ≠ 0 if any down). |
| `npm run ports` | Show every registry port and who owns it. |
| `npm run graph` | Validate the graph, print the startup order, regenerate `dev/GRAPH.md`. |
| `npm run clean` | Remove runtime logs + state (`-- --dist` also clears build output). |
| `npm run stop` | Stop everything cleanly (orchestrator or fallback port-based). |
| `npm run restart` | Stop, then restart the last profile. |
| `npm run dev:list` / `dev:plan` | List services / show the start plan without starting. |
| `npm run test:dev` | Run the infrastructure test suite. |

`make` aliases exist for all of the above (`make dev`, `make doctor`, …).

Flags on `dev`: `--profile=NAME`, `--only=a,b`, `--except=a,b`,
`--on-conflict=prompt|reuse|restart|abort`, `--no-restart`, `--dry-run`, `--list`.

---

## 6. Health checks

Each service declares how "ready" is determined:

- **http** — GET a URL until it returns an acceptable status (`expect` for an
  exact code; otherwise any `< 500`).
- **tcp** — until the `port` accepts a connection.
- **log** — until a stdout/stderr line matches the `match` regex (for workers
  with no port).
- **none** — ready as soon as the process spawns.

Readiness gates dependents (see §8). After startup, the dashboard/status/health
commands re-probe live so you always see current reality, not a cached verdict.

---

## 7. Port management

- Every declared port is checked **before** launch. `npm run ports` shows the
  free/busy table with owners at any time.
- On a conflict, `--on-conflict` decides: **reuse** (leave it, mark the service
  ready), **restart** (kill the holder, start fresh), **abort**, or **prompt**
  (interactive; auto-falls back to reuse when not a TTY).
- The backend additionally guards its own port via a `predev` hook, so a stray
  second start fails fast with guidance instead of a stack trace.

---

## 8. Startup sequence

```
load + validate registry
        │
        ▼
apply profile ── resolve selector + transitive deps → active service set
        │
        ▼
port check ── free ✓ | busy → reuse/restart/abort/prompt
        │
        ▼
launch (event-driven): every active service starts concurrently, but each
   AWAITS its dependencies reaching a terminal readiness state first.

        wave 0:  python-mcp        (no deps)     ── start in parallel
        wave 1:  backend           (needs mcp)
        wave 2:  frontend          (needs backend)

   per service:  spawn (own process group)
                   → stream logs → console + dev/logs/<id>.log
                   → run health probe until ready or timeout
        │
        ▼
publish runtime state → dev/.runtime/state.json  (status/dashboard read this)
        │
        ▼
steady state: stream logs, supervise, auto-restart with backoff
```

**Gating semantics.** A dependent waits for each dependency to reach *healthy*
or *failed/timed-out*, then: `lenient` (default) proceeds with a warning;
`strict` marks the dependent **blocked**. Avoid putting a long-`timeoutMs`
service in another's `dependsOn` unless the ordering is truly required.

---

## 9. Shutdown sequence

```
Ctrl+C / SIGTERM / `npm run stop`
        │
        ▼
stop dependents before dependencies (reverse topological order)
        │
        ▼
each service: SIGTERM its process GROUP → wait grace period → SIGKILL stragglers
        │
        ▼
clear dev/.runtime/state.json
```

Because every service runs in its own process group, the whole subtree
(`npm → ts-node-dev → node`, `uv → uvicorn`, …) is taken down together — **no
orphaned processes, no lingering ports**. Reused external processes (started
outside the orchestrator) are deliberately left alone.

---

## 10. Development workflow

```bash
npm install            # once, at the repo root (installs js-yaml)
npm run doctor         # verify toolchain, keys, Atlas, ports
npm run dev:core       # daily driver: backend + frontend + mcp
# ... in another terminal:
npm run dashboard      # watch health/CPU/mem live
npm run logs backend   # follow one service
npm run stop           # done for the day
```

- Working on just the API? `npm run dev:backend`.
- Options/screening research? `npm run dev:research`.
- Adding a service? Edit `dev/registry.yaml`, run `npm run graph`, start its profile.

---

## 11. Testing

`npm run test:dev` runs the infrastructure suite (Node's built-in test runner,
zero extra deps):

- **registry** — valid load + rejects duplicate ports, unknown deps, cycles,
  missing commands, bad profile ids.
- **graph** — toposort (deps before dependents), startup waves, Mermaid output.
- **profiles** — id/category/tag matching, transitive deps, disabled exclusion.
- **health** — http/tcp probes against real local servers.
- **ports** — conflict detection against a bound port.
- **ordering** — integration: a dependent starts only after its dependency is
  healthy; a strict dependent is blocked when its dependency never gets healthy.

---

## 12. Troubleshooting

**`doctor` shows a ✗** — fix the specific item. `fail` items (missing tool,
missing required env, Atlas unreachable) will block services; `warn` items
(a `.env` absent, a port already in use, a service not running) usually won't.

**A port is busy / a service shows `reused`** — something already holds it:
```bash
npm run ports                        # who owns what
npm run dev:core -- --on-conflict=restart   # kill holders and start fresh
```

**A service is stuck `starting` → `unhealthy`** — its health check never passed
within `timeoutMs`. Read `dev/logs/<id>.log`; check the `health.url`/port; raise
`timeoutMs` if it just needs longer.

**A dependent won't start** — it's waiting on a dependency's readiness. If the
dependency has a long `timeoutMs`, the dependent waits that long. Fix the
dependency's health or reconsider the `dependsOn` edge.

**A service keeps restarting then `failed`** — it exited non-zero more than
`restart.maxRetries` times. Read its log; set `restart.policy: never` while
debugging, or run it alone: `npm run dev -- --only=<id>`.

**Python services fail** — they run via `uv`. Ensure `uv` is installed and the
service's `.env` exists. The screener's first run resolves deps via `uv`, which
can take a while (its health timeout is set high for that).

**Orphaned processes** — shouldn't happen via the orchestrator (it group-kills).
For something started by hand:
```bash
PID=$(lsof -nP -iTCP:4000 -sTCP:LISTEN -t); kill -TERM -$(ps -o pgid= -p $PID | tr -d ' ')
```
Or just `npm run stop`, which falls back to port-based cleanup when no
orchestrator is running.

**Plain logs / CI** — set `NO_COLOR=1` (also auto-detected when output isn't a TTY).

---

See also: **[GRAPH.md](./GRAPH.md)** (auto-generated dependency diagram) and the
inline field reference at the top of **[registry.yaml](./registry.yaml)**.
