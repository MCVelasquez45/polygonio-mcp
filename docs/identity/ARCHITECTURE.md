# Identity Platform — Architecture (AI-Trader V3, Phase 1)

Status: **Phase 1 foundation.** This document is the contract that the identity
implementation follows. It supersedes ad-hoc auth assumptions in the codebase.

---

## 1. Mission & Non-Goals

**Mission.** Turn AI-Trader from a single-operator workstation into a multi-user
platform. Every future object (workspaces, broker connections, AI memory,
automation, reporting) belongs to a **user**, not to the application.

**This phase builds only the identity layer.** It does **not** change:

- Trading logic, execution gateway, risk engine, automation schedulers
- Market-data integration (Massive / Polygon-compatible), charts, WebSocket feeds
- MongoDB schemas of any existing trading collection
- GPT prompts, AI evaluation, or decision logic

Identity is **additive**. Existing routes and background workers keep operating
under the legacy default identity until enforcement is explicitly flipped
(see §11, Rollout).

### In scope (Phase 1, this pass)

- Email / password accounts: registration, email verification, login, password
  reset / forgot password, remember-me, logout, logout-everywhere.
- Google OAuth (live) with a provider abstraction for future providers.
- JWT access tokens + rotating opaque refresh tokens with reuse detection.
- Device/session management, revocation.
- RBAC: `admin`, `trader`, `analyst`, `viewer`.
- Profile management (name, avatar, timezone, trading experience, theme,
  workspace name).
- Identity collections incl. scaffolds for organizations, memberships, roles,
  broker connections, api tokens, audit logs.
- Protected frontend: enterprise login/register/profile UX, route protection,
  session restoration.
- Security: Argon2id hashing, encrypted secrets, HTTP-only + SameSite cookies,
  CSRF protection, rate limiting, account lockout, audit logging, security
  headers.

### Scaffolded now, deepened later (explicit follow-ups)

- **Organizations / Memberships / Teams**: first-login provisioning creates a
  default organization and membership. Management endpoints and shared-resource
  semantics land in Phase 1.x.
- **Broker connection framework**: `broker_connections` model with envelope
  encryption for secrets, and a provider registry. First login creates disabled
  placeholders for Alpaca, Tradier, IBKR, Tastytrade, and Paper. **No live
  broker calls** and no credential capture UI in this pass — the trading
  engine's existing Alpaca façade is untouched.
- **API tokens**: model + hashing created; issuance UI/endpoints later.

---

## 2. Where identity plugs into the existing system

The backend already ships a **staged identity seam**:
`server/src/shared/auth/requestIdentity.ts` stamps every request with
`req.auth = { authenticated, actorId, accountId, roles[], authMethod,
enforcementMode }` and supports an `observe → required` enforcement flip. Today
it only recognizes a single static bearer token and otherwise falls back to a
default `legacy-operator` identity.

Phase 1 grows real identity **into this same seam** rather than replacing it:

```
Request
  │
  ├─ requestId middleware            (unchanged)
  ├─ identity middleware             (EXTENDED)
  │     1. Try identity JWT  ───────────────► req.auth from verified user + roles
  │     2. Else try legacy static token ────► req.auth (legacy bearer)  [unchanged]
  │     3. Else default legacy-operator ────► req.auth (observe mode)   [unchanged]
  │
  ├─ /api/auth/*  (NEW routers: register, login, refresh, oauth, sessions, ...)
  └─ existing /api/* routers          (unchanged)
```

**Guarantee:** with `AI_TRADER_AUTH_ENFORCEMENT=observe` (default), no existing
request is rejected. The frontend gains a real login; the backend keeps
accepting legacy/worker traffic. Flipping to `required` is a deliberate,
documented migration step (§11).

Frontend seams (both centralized, single edit points):

- `client/src/api/http.ts` — axios instance → attach `Authorization: Bearer`
  + one-shot 401 refresh-and-retry.
- `client/src/lib/socket.ts` — Socket.IO singleton → pass access token in the
  handshake `auth` payload.
- `client/src/App.tsx` is wrapped by an `AuthGate`; the existing view-based
  workspace is rendered **unchanged** once authenticated.

---

## 3. Token & session model

Two token types, deliberately split:

| Token | Type | Lifetime | Storage (client) | Storage (server) | Purpose |
|-------|------|----------|------------------|------------------|---------|
| **Access** | Signed JWT (HS256) | 15 min | **in-memory only** (JS var) | none (stateless) | Authorize API + socket |
| **Refresh** | Opaque 256-bit random | 30d (remember-me) / 12h (session) | **HTTP-only cookie** | SHA-256 hash in `identity_sessions` | Mint new access tokens |

Rationale:

- **No sensitive token in `localStorage`** (OWASP; spec requirement). Access
  token lives only in memory and is re-derived on load via the refresh cookie
  (silent refresh). A hard reload briefly shows a loading state, then restores
  the session.
- **Access token is stateless** (fast, no DB hit per request) but short-lived,
  bounding the blast radius of leakage.
- **Refresh token is stateful** → enables revocation, device sessions,
  logout-everywhere, and **reuse detection**.

### Access JWT claims

```
{
  sub:  <userId>,
  sid:  <sessionId>,          // ties access token to a refresh session
  roles: ["trader"],          // global roles snapshot
  wsp:  <workspaceName>,      // convenience
  typ:  "access",
  iat, exp, iss: "ai-trader-identity", aud: "ai-trader"
}
```

Signed with `IDENTITY_JWT_SECRET`. Rotating this secret invalidates all access
tokens immediately (refresh still works → users transparently re-mint).

### Refresh rotation + reuse detection

Every `/api/auth/refresh` call **rotates** the refresh token:

1. Look up session by SHA-256 hash of presented refresh token.
2. If not found **or already rotated (has a `rotatedTo`)** → **token reuse**:
   revoke the entire session lineage (`familyId`), write a `SECURITY` audit
   event, force re-login. This defeats stolen-refresh-token replay.
3. If valid: mark current record rotated, issue a new refresh token in the same
   `familyId`, set new HTTP-only cookie, return a fresh access token.

Sessions carry: `userId`, `familyId`, `tokenHash`, `rotatedTo`, `revokedAt`,
`device` (UA + coarse IP), `createdAt`, `lastUsedAt`, `expiresAt` (TTL index),
`rememberMe`.

---

## 4. Cookies & CSRF

| Cookie | Flags | Scope |
|--------|-------|-------|
| `id_refresh` | `HttpOnly; Secure*; SameSite=Lax; Path=/api/auth` | refresh + logout only |
| `id_csrf` | `Secure*; SameSite=Lax; Path=/` (readable by JS) | double-submit token |

`Secure` is set in production (behind HTTPS); relaxed on `http://localhost` for
dev. `SameSite=Lax` allows the top-level OAuth redirect to carry the cookie while
blocking cross-site POSTs.

**CSRF (double-submit).** Cookie-authenticated state-changing endpoints
(`/api/auth/refresh`, `/api/auth/logout*`) require header `X-CSRF-Token` to equal
the `id_csrf` cookie value (timing-safe compare). Bearer-authenticated API calls
are **not** CSRF-vulnerable (no ambient cookie authority) and are exempt.

**CORS.** In dev, UI (`:5173`) and API (`:4000`) are cross-origin, so cookies
require `Access-Control-Allow-Credentials: true` with a **reflected, allow-listed
origin** (never `*`). In production the Vercel proxy makes it same-origin. This
is the one change to existing CORS config and is additive.

---

## 5. Data model (new collections)

All identity collections are prefixed `identity_` to avoid any collision with
trading collections. `timestamps: true` everywhere (repo convention).

| Collection | Purpose | Key fields / indexes |
|------------|---------|----------------------|
| `identity_users` | Account of record | `email` (unique, lowercased), `emailVerified`, `passwordHash` (Argon2id, nullable for OAuth-only), `status` (`active`/`disabled`/`pending`), `roles[]`, `profile{name,avatarUrl,timezone,tradingExperience,preferredTheme,workspaceName}`, `oauth[{provider,subject,email}]`, `failedLoginCount`, `lockedUntil`, `lastLoginAt` |
| `identity_sessions` | Refresh-token sessions / devices | `userId`, `familyId`, `tokenHash` (unique), `rotatedTo`, `revokedAt`, `device{ua,ip}`, `rememberMe`, `expiresAt` (**TTL**) |
| `identity_email_tokens` | Verify + reset one-time tokens | `userId`, `type` (`verify`/`reset`), `tokenHash` (unique), `usedAt`, `expiresAt` (**TTL**) |
| `identity_audit_logs` | Security/audit trail (append-only) | `actorId`, `action`, `targetType`, `targetId`, `ip`, `ua`, `outcome`, `meta`, `createdAt` (index) |
| `identity_broker_connections` | **Scaffold.** User↔broker links | `userId`, `provider`, `label`, `status`, `secretCiphertext{iv,tag,data}` (AES-256-GCM), `createdAt` |
| `identity_api_tokens` | **Scaffold.** Programmatic access | `userId`, `name`, `tokenHash` (unique), `scopes[]`, `lastUsedAt`, `expiresAt`, `revokedAt` |
| `identity_organizations` | **Scaffold.** Tenancy | `name`, `slug` (unique), `ownerId`, `status` |
| `identity_memberships` | **Scaffold.** User↔org↔roles | `userId`, `orgId`, `roles[]` (unique `{userId,orgId}`) |
| `identity_roles` | Seeded RBAC catalog | `key` (unique), `label`, `permissions[]` |
| `identity_workspace_profiles` | First-login workspace defaults | `userId` (unique), `orgId`, `defaultWatchlist[]`, `aiMemory`, `journal`, `brokerOnboarding` |

Existing trading collections are **not** modified. Multi-tenant scoping of
trading data (`ownerId`/`orgId` on trading models) is a deliberate later phase;
until then trading data continues under the default account.

First-login provisioning is idempotent and happens inside session creation for
email/password and OAuth logins. It creates the organization, membership,
workspace profile, default watchlist seed, AI memory seed, journal seed, and
broker onboarding records without asking the user during signup.

---

## 6. RBAC

Roles are global (Phase 1). Org-scoped roles arrive with the memberships layer.

| Role | Inherits | Representative permissions |
|------|----------|-----------------------------|
| `viewer` | — | `workspace:read`, `market:read`, `portfolio:read` |
| `analyst` | viewer | `intelligence:read`, `research:run` |
| `trader` | analyst | `order:create`, `automation:control`, `watchlist:write` |
| `admin` | trader | `user:manage`, `role:assign`, `audit:read`, `org:manage`, `system:admin` |

The role→permission matrix is **code-defined** (single source of truth in
`shared/identity/rbac.ts`) and mirrored into the seeded `identity_roles`
collection for queryability. Guards:

- `requireAuth` — 401 if `req.auth.authenticated` is false.
- `requireRole(...roles)` — 403 unless the user holds one of the roles.
- `requirePermission(...perms)` — 403 unless the user's roles grant all perms.

Mapping to the legacy `AuthRole` union (`viewer|trader|operator|administrator`):
`admin→administrator`, `analyst→viewer`, others map by name, so `req.auth.roles`
stays valid for existing consumers/logs.

---

## 7. Password & secret cryptography

- **Passwords:** Argon2id via `@node-rs/argon2` (prebuilt binaries; no native
  build in Docker). Parameters: memoryCost 19456 KiB, timeCost 2, parallelism 1
  (OWASP baseline), tuned via env. Never logged; redacted by existing logging.
- **Password policy:** ≥12 chars, not in a small common-password denylist,
  enforced server-side before hashing.
- **Refresh / email / api tokens:** 256-bit random, compared by SHA-256 hash;
  raw value shown once (email link / cookie).
- **Broker secrets (scaffold):** AES-256-GCM envelope encryption with a 32-byte
  master key from `IDENTITY_ENCRYPTION_KEY` (base64). Stored as `{iv,tag,data}`.
  Decryption only in-process at point of use (no broker use in Phase 1).
- **Timing-safe compares** for all token/CSRF equality (reusing the existing
  `crypto.timingSafeEqual` idiom).

---

## 8. Rate limiting, lockout, brute force

- **IP rate limit** on `/api/auth/*`: sliding window (default 20 req / 60s /
  IP), in-memory (single long-running instance; Redis later). Mirrors the style
  of `shared/ai/controls.ts`.
- **Account lockout:** `failedLoginCount` increments on bad password; after 5
  fails within the window, `lockedUntil` is set (default 15 min) → login fails
  with the same generic invalid-credentials response. Successful login resets
  the counter.
- **Enumeration resistance:** register, forgot-password, and login return
  generic responses that don't reveal whether an email exists.

---

## 9. Authentication flows

### Register → verify → login

1. `POST /api/auth/register {email,password,workspaceName?}` → create user
   (`status=pending`, `emailVerified=false`), issue verify token, send email
   (dev transport logs the link). Generic 201.
2. `GET/POST /api/auth/verify-email?token=…` → mark verified, `status=active`.
3. `POST /api/auth/login {email,password,rememberMe?}` → verify Argon2id, issue
   access JWT + refresh cookie + csrf cookie, create session, audit `LOGIN`.

### Refresh / logout

- `POST /api/auth/refresh` (cookie + CSRF) → rotate, new access token.
- `POST /api/auth/logout` → revoke current session, clear cookies.
- `POST /api/auth/logout-all` → revoke all sessions for the user.

### Forgot / reset

- `POST /api/auth/forgot-password {email}` → issue reset token, email link.
  Generic 200.
- `POST /api/auth/reset-password {token,password}` → set new hash, **revoke all
  sessions** (logout everywhere), audit `PASSWORD_RESET`.

### Google OAuth (live)

- `GET /api/auth/google?returnTo=/...` → 302 to Google with a signed state
  payload. Only relative `returnTo` paths are accepted, which prevents open
  redirects while supporting staging/prod frontend paths.
- `GET /api/auth/google/callback?code&state` → verify state, exchange code
  (`google-auth-library`), verify ID token, upsert user by verified email
  (link `oauth`), mark `emailVerified=true`, set refresh/CSRF cookies, redirect
  to the frontend. The SPA then calls `/api/auth/refresh` to mint an in-memory
  access token.
- `POST /api/auth/google/credential` → verifies a Google Identity Services ID
  token for One Tap / credential flows and issues the same session shape.

### Profile / sessions

- `GET /api/auth/me` → current user + roles + profile.
- `PATCH /api/auth/profile` → update profile fields (zod-validated).
- `GET /api/auth/sessions` / `DELETE /api/auth/sessions/:id` → list / revoke
  devices.

---

## 10. Socket.IO authentication

`io.use()` middleware reads `socket.handshake.auth.token` (access JWT). In
`observe` mode an unauthenticated socket is allowed (attached as legacy identity)
so the existing live feed keeps working; in `required` mode a missing/invalid
token rejects the connection. The client passes the in-memory access token in
the handshake and reconnects on token refresh.

---

## 11. Rollout / migration (single-user → multi-user)

Enforcement is a dial, not a switch-flip-and-pray:

1. **Ship in `observe`** (default). Identity endpoints live; UI login works;
   nothing rejects legacy traffic. Verify in staging.
2. **Seed or register the first admin.** The first registered user is assigned
   `admin`; alternatively create one directly in Mongo during a controlled
   migration.
3. **Point background workers/service-to-service** at a minted API token or the
   retained static token (both still honored).
4. **Flip `AI_TRADER_AUTH_ENFORCEMENT=required`.** Now unauthenticated mutating
   `/api/*` calls are rejected; GETs remain open (existing behavior). Socket
   requires a token.
5. **Later phases:** add `ownerId` to trading collections + backfill to the
   seeded admin; introduce org scoping; enable broker-connection capture.

Full step-by-step lives in `docs/identity/MIGRATION_GUIDE.md`; go/no-go
criteria live in `docs/identity/VERIFICATION_REPORT.md`.

---

## 12. File map (server)

```
server/src/shared/identity/
  config.ts            env parsing + validation (fail-closed when required)
  rbac.ts              role→permission matrix, mappers to legacy AuthRole
  crypto.ts            random tokens, sha256, AES-256-GCM envelope
  password.ts          Argon2id hash/verify + policy
  jwt.ts               access-token sign/verify
  cookies.ts           secure cookie helpers (refresh, csrf)
  csrf.ts              double-submit verify
  rateLimit.ts         sliding-window IP limiter
  oauthState.ts        signed Google OAuth state + return path validation
server/src/features/identity/
  models/*.ts          Mongoose models (§5)
  services/            userService, sessionService, emailService, oauthService,
                       auditService
  identity.middleware.ts   requireMongoIdentity / requireAuthenticated /
                           requirePermissions
  identity.routes.ts   all /api/auth/* endpoints
  identity.migrations.ts   additive RBAC catalog seed
```

## 13. File map (client)

```
client/src/auth/
  AuthContext.tsx      provider + useAuth (in-memory token, silent refresh)
  authApi.ts           typed calls to /api/auth/*
  AuthScreen.tsx       login/register/forgot/reset/verify screens
  ProfileMenu.tsx      profile + device sessions + logout
  tokenStore.ts        memory-only access token + CSRF cookie reader
```

Enterprise dark aesthetic reuses the existing **Intel palette** (`intel.bg`,
`intel.panel`, `intel.accent`, semantic channels) — no consumer styling, no
gradients/neon.

---

## 14. Acceptance criteria (Phase 1)

A user can register, verify email, log in (password or Google), recover a
password, manage their profile, and maintain secure rotating sessions across
devices with logout-everywhere — accessing only authorized routes — **without any
change to trading, automation, AI, or market-data behavior**, and with the
existing test suites still green.
