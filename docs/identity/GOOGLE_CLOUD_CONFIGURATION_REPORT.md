# Google Cloud Configuration Report

Status: blocked on manual Google Cloud Console OAuth configuration.

Generated: 2026-08-01

This report covers Google Cloud OAuth infrastructure only. No authentication
routes, handlers, frontend UI, session logic, or Identity Platform business
logic were redesigned.

## 1. Google Cloud SDK

Verified actions:

- Installed Google Cloud CLI with Homebrew cask `gcloud-cli`.
- Verified SDK version: `Google Cloud SDK 578.0.0`.
- Authenticated account: `mcvelasquez45@gmail.com`.
- Active gcloud configuration: `default`.
- Active project: `ai-trading-auth`.

Command evidence:

```bash
gcloud version
gcloud auth login
gcloud auth list
gcloud config list
gcloud services list --enabled --project ai-trading-auth
gcloud iam oauth-clients list --project ai-trading-auth --location=global
```

## 2. Project

Verified project:

- Project ID: `ai-trading-auth`
- Project name: `Ai-trading-Auth`
- Project number: `768973950716`
- Lifecycle state: `ACTIVE`

No duplicate project was created.

## 3. Enabled APIs

Enabled services currently present on `ai-trading-auth` include:

- `cloudapis.googleapis.com`
- `logging.googleapis.com`
- `monitoring.googleapis.com`
- `people.googleapis.com`
- `serviceusage.googleapis.com`
- Storage/BigQuery related services from prior project usage

OAuth assessment:

- The current AI-Trader backend uses `google-auth-library` for OAuth
  Authorization Code exchange and ID token verification.
- The backend requests scopes: `openid`, `email`, `profile`.
- The backend does not call People API for profile lookup.
- No additional Google API was enabled for this task.
- There is no separate `oauth2.googleapis.com` service required for this web
  OAuth client flow.
- `gcloud iam oauth-clients list --project ai-trading-auth --location=global`
  returned `[]`. That command manages IAM/IAP-style OAuth resources and did not
  reveal a Google Auth Platform web client for this app.
- `gcloud auth-platform` is not a valid command in Google Cloud SDK 578.0.0.
  The standard Google Auth Platform consent screen and web-client origins are
  still Console-owned for this configuration path.

## 4. OAuth Consent Screen

Status: manual verification/configuration required in Google Cloud Console.

Required consent screen settings:

- App name: `AI-Trader`
- User type / publishing status: `External`
- User support email: select the operator support email for this account
- Developer contact email: select the operator/security email for this account
- Scopes:
  - `openid`
  - `email`
  - `profile`

Do not request additional scopes.

Manual Console URL:

```text
https://console.cloud.google.com/apis/credentials/consent?project=ai-trading-auth
```

## 5. OAuth Client

Status: manual creation/verification required in Google Cloud Console.

Required client type:

- OAuth 2.0 Client ID
- Application type: `Web application`
- Suggested name: `AI-Trader Web`

Client ID:

```text
<pending manual Console creation or verification>
```

Client secret:

```text
<redacted; copy directly into Render GOOGLE_CLIENT_SECRET>
```

Manual Console URL:

```text
https://console.cloud.google.com/apis/credentials?project=ai-trading-auth
```

## 6. Authorized JavaScript Origins

Configure exactly these origins on the OAuth web client:

```text
http://localhost:5173
http://localhost:4173
https://polygonio-mcp-beryl.vercel.app
```

Custom production domain:

- None verified in the repository.
- Do not add a custom frontend origin until the domain exists and is assigned.

Rules:

- No wildcard origins.
- No insecure production origins.
- Do not add the Render backend URL as a JavaScript origin unless the frontend is
  actually served from Render.

## 7. Authorized Redirect URIs

Configure exactly these redirect URIs on the OAuth web client:

```text
http://localhost:4000/api/auth/google/callback
https://polygonio-backend.onrender.com/api/auth/google/callback
```

Custom backend domain:

- None verified in the repository.
- Do not add a custom backend callback until the domain exists and is assigned.

Rules:

- No wildcard redirect URIs.
- No frontend callback URI for this server-side Authorization Code Flow.
- The production callback must terminate at Render, not Vercel.

## 8. Backend Environment Checklist

Render service: `https://polygonio-backend.onrender.com`

Verified Render service metadata:

- Service ID: `srv-d9efc4taeets73b39dc0`
- Service name: `polygonio-backend`
- URL: `https://polygonio-backend.onrender.com`
- Repo: `https://github.com/MCVelasquez45/polygonio-mcp`
- Root directory: `server`
- Branch: `main`
- Auto deploy: enabled on commit
- Build command: `npm install && npm run build`
- Start command: `npm start`

Verified Render environment state:

- `MONGO_URI`: present, value redacted
- `FRONTEND_ORIGIN`: present
- `CORS_ORIGINS`: present
- `NODE_ENV`: present and set to `production`
- `GOOGLE_PROJECT_ID`: missing
- `GOOGLE_CLIENT_ID`: missing
- `GOOGLE_CLIENT_SECRET`: missing
- `GOOGLE_REDIRECT_URI`: missing
- `GOOGLE_CALLBACK_URL`: missing
- `IDENTITY_APP_BASE_URL`: missing
- `IDENTITY_API_BASE_URL`: missing
- `IDENTITY_COOKIE_SECURE`: missing
- `MONGO_OPTIONAL`: missing

Set these Render environment variables after creating/verifying the OAuth web
client:

```bash
GOOGLE_PROJECT_ID=ai-trading-auth
GOOGLE_CLIENT_ID=<oauth-web-client-id>
GOOGLE_CLIENT_SECRET=<oauth-web-client-secret>
GOOGLE_REDIRECT_URI=https://polygonio-backend.onrender.com/api/auth/google/callback
IDENTITY_APP_BASE_URL=https://polygonio-mcp-beryl.vercel.app
IDENTITY_API_BASE_URL=https://polygonio-backend.onrender.com
IDENTITY_COOKIE_SECURE=true
CORS_ORIGINS=https://polygonio-mcp-beryl.vercel.app
FRONTEND_ORIGIN=https://polygonio-mcp-beryl.vercel.app
MONGO_OPTIONAL=false
NODE_ENV=production
```

Compatibility alias:

```bash
GOOGLE_CALLBACK_URL=https://polygonio-backend.onrender.com/api/auth/google/callback
```

`GOOGLE_REDIRECT_URI` is canonical and wins if both variables are set. Use the
alias only if an existing Render secret set already depends on it.

Do not print `GOOGLE_CLIENT_SECRET` into logs, tickets, screenshots, or chat.

## 9. Vercel Environment Checklist

Frontend: `https://polygonio-mcp-beryl.vercel.app`

The Vite production build is designed to use same-origin requests through
`client/vercel.json` rewrites. Required Vercel variables:

```bash
VITE_API_BASE_URL=https://polygonio-mcp-beryl.vercel.app
VITE_SOCKET_URL=https://polygonio-mcp-beryl.vercel.app
VITE_APP_ENV=production
```

Do not set `VITE_API_BASE_URL` or `VITE_SOCKET_URL` to
`https://polygonio-backend.onrender.com` for the Vercel production bundle.

Verified Vercel rewrite target in `client/vercel.json`:

```text
/api/* -> https://polygonio-backend.onrender.com/api/*
/socket.io* -> https://polygonio-backend.onrender.com/socket.io*
```

## 10. Existing OAuth Implementation Review

Verified local implementation:

- Route mount: `server/src/index.ts` mounts `identityRouter` at `/api/auth`.
- Login start: `GET /api/auth/google`.
- Callback: `GET /api/auth/google/callback`.
- GIS credential endpoint: `POST /api/auth/google/credential`.
- Authorization Code Flow is implemented via `google-auth-library`.
- Requested scopes are exactly `openid`, `email`, `profile`.
- Google ID token audience is verified against `GOOGLE_CLIENT_ID`.
- Google email must be present and verified.
- Existing account linking is supported by provider subject and verified email.
- OAuth-only new user creation is supported.
- Successful OAuth login creates a normal Identity Platform session, refresh
  token, CSRF cookie, and audit log.

Environment compatibility verified:

- `GOOGLE_CLIENT_ID` expected.
- `GOOGLE_CLIENT_SECRET` expected.
- `GOOGLE_REDIRECT_URI` expected.
- `GOOGLE_CALLBACK_URL` supported as compatibility alias.
- `GOOGLE_PROJECT_ID` documented and read by configuration.

## 11. Security Review

Verified controls:

- Authorization Code Flow, not Implicit Flow.
- Signed OAuth `state` parameter.
- State expiry: 10 minutes.
- Timing-safe state signature comparison.
- Relative-only `returnTo` normalization prevents open redirects.
- Google ID token audience validation.
- Verified Google email required.
- Refresh token rotation through existing session service.
- HttpOnly refresh cookie through existing cookie helper.
- CSRF double-submit cookie/header protection on cookie-authenticated
  state-changing auth endpoints.
- Audit logging for Google login.
- Session fixation resistance through new session creation after OAuth callback.

Documented gaps / hardening items:

- PKCE is not currently implemented for the server-side OAuth web flow. This is
  acceptable for a confidential web server client with a protected client
  secret, but PKCE would be a useful defense-in-depth improvement.
- The generated OAuth state contains a nonce for uniqueness, but the flow does
  not send an OIDC `nonce` parameter to Google or validate a nonce claim.
- OAuth state is signed and time-limited, but not stored server-side as a
  one-time-use state value. Replay within the validity window is mitigated by
  code single-use semantics at Google, but not independently rejected by local
  state storage.

No security issue above was silently modified because this task is
infrastructure-only.

## 12. Production Validation

Live endpoint checks performed:

```text
GET https://polygonio-backend.onrender.com/api/auth/config -> 404 Cannot GET /api/auth/config
GET https://polygonio-mcp-beryl.vercel.app/api/auth/config -> 404 Cannot GET /api/auth/config
```

Interpretation:

- The local repository contains `/api/auth/config`.
- The deployed Render backend currently does not expose the Identity Platform
  auth routes.
- Vercel rewrites correctly reach Render, but Render is serving an older or
  differently configured backend build.

Deployment evidence:

- Render live backend deployment: `dep-d9inld3eo5us73d00hug`
- Render live commit:
  `d48788ad8b0febefbbd7643865da3daeb8ed93c6`
- Render live commit message: merge PR #59
  `v2/autonomous-system-integration` into `main`
- Render live deployment finished: `2026-07-26T03:12:07.650272Z`
- Remote `main` SHA verified with `git ls-remote origin main`:
  `d6ae1de5d2b55338e669241bdcac75780e8a6e16`
- Current local branch: `v3/identity-platform`
- Current local branch contains the Identity Platform implementation on
  `v3/identity-platform`.
- GitHub `main` does not contain
  `server/src/features/identity/identity.routes.ts`.

Root cause for the production `404`:

- Not a missing local route. The route exists locally and is mounted by
  `server/src/index.ts`.
- Not a callback URL typo. The 404 occurs on `/api/auth/config`, before Google
  redirect handling.
- The Identity Platform implementation is present in the current worktree but
  is not on GitHub `main`, and Render deploys from `main`.
- Render's live deployment is older than both current `main` and the current
  Identity Platform worktree.

Production Google OAuth cannot be validated until Render is updated with this
Identity Platform build and the environment variables above.

## 12.1 Local Implementation Verification

Final local verification performed on the `v3/identity-platform` worktree:

- `npm --prefix server run lint` -> passed.
- `npm --prefix client run lint` -> passed.
- `npm --prefix client run test` -> 35 files, 169 tests passed.
- `npm --prefix server run test` -> 466 tests passed, 0 failed, 0 skipped.
- `npm --prefix client run build` -> passed; postbuild guard confirmed no
  backend/loopback origin was embedded in the production bundle.
- `PLAYWRIGHT_BASE_URL=http://localhost:5174 npm --prefix client run test:e2e -- --workers=1`
  -> 31 passed, 1 pre-existing desktop skip for the mobile-only assertion.
- `git diff --check` -> passed.
- `npm --prefix server audit --audit-level=high` -> found 0 vulnerabilities.
- `npm --prefix client audit --audit-level=high` -> found 0 vulnerabilities.

Playwright setup used an isolated local stack:

- Backend: `http://localhost:4001`
- Frontend: `http://localhost:5174`
- Frontend E2E flag: `VITE_E2E_TEST_IDENTITY=true`
- Backend CORS origin: `http://localhost:5174`

The E2E collector reported zero browser console errors, zero uncaught page
errors, zero failed requests, zero 5xx responses, and zero forbidden-origin
requests for every executed test in the final serial run.

Implementation note:

- `/api/system/status` now returns HTTP 200 with semantic `RUNNING`,
  `DEGRADED`, `BLOCKED`, or `STOPPED` in the JSON payload. `/api/system/health`
  remains the liveness/health endpoint that can return 503. This prevents
  expected cockpit blocked/degraded states from becoming browser-level 5xx
  errors while preserving health-check behavior.

Secret-source note:

- The user stated that `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` were added
  to `.enc`. No `.enc` file was found under this repository path during local
  verification, so the secret values were not read or printed by this run.

## 13. Render Deployment Checklist

Do not deploy until the manual Google Console OAuth client exists.

Render steps:

1. Open the Render backend service dashboard.
2. Add the environment variables from section 8.
3. Confirm Mongo Atlas `MONGO_URI` is configured and `MONGO_OPTIONAL=false`.
4. Confirm `IDENTITY_JWT_SECRET` and `IDENTITY_ENCRYPTION_KEY` are production
   values.
5. Deploy the backend build that contains `server/src/features/identity`.
6. Restart the Render service.
7. Verify:

```bash
curl https://polygonio-backend.onrender.com/api/auth/config
```

Expected:

```json
{"googleConfigured":true,"googleClientId":"<client-id>"}
```

## 14. End-to-End Verification Checklist

After Console and Render configuration:

1. Visit `https://polygonio-mcp-beryl.vercel.app/auth/login`.
2. Click `Continue with Google`.
3. Confirm Google shows app name `AI-Trader`.
4. Confirm scopes are only `openid`, `email`, `profile`.
5. Confirm redirect URI is:

```text
https://polygonio-backend.onrender.com/api/auth/google/callback
```

6. Confirm callback returns to:

```text
https://polygonio-mcp-beryl.vercel.app/
```

7. Confirm dashboard loads.
8. Confirm `/api/auth/me` returns the Google user.
9. Confirm Mongo contains one user for the Google email.
10. Confirm the user has an `oauth.provider=google` link.
11. Log out and confirm refresh/CSRF cookies are cleared.
12. Reload and confirm signed-out state.
13. Log in again with the same Google account and confirm no duplicate user is
    created.
14. Create an email/password account with the same verified email, then sign in
    with Google and confirm account linking uses the existing user.
15. Refresh the page and confirm session restoration.
16. Wait for access token expiry or force refresh and confirm refresh token
    rotation succeeds.

## 15. Manual Google Console Steps

Manual interaction is required now.

Open the consent screen:

```text
https://console.cloud.google.com/apis/credentials/consent?project=ai-trading-auth
```

Click path:

1. Choose `External`.
2. Set app name to `AI-Trader`.
3. Set user support email.
4. Set developer contact email.
5. Add only scopes `openid`, `email`, `profile`.
6. Save.

Open the credentials page:

```text
https://console.cloud.google.com/apis/credentials?project=ai-trading-auth
```

Click path:

1. Click `Create Credentials`.
2. Click `OAuth client ID`.
3. Select application type `Web application`.
4. Name it `AI-Trader Web`.
5. Add the authorized JavaScript origins from section 6.
6. Add the authorized redirect URIs from section 7.
7. Click `Create`.
8. Copy the client ID to Render as `GOOGLE_CLIENT_ID`.
9. Copy the client secret directly to Render as `GOOGLE_CLIENT_SECRET`.

## 16. Remaining Blockers

- OAuth consent screen could not be verified or configured from `gcloud`.
- OAuth web client could not be verified or created from `gcloud`.
- OAuth client ID is not yet known.
- OAuth client secret is not yet created or copied to Render.
- Render currently returns `404` for `/api/auth/config`; the deployed backend
  does not yet expose the Identity Platform routes.
- Production Google login cannot be validated until Console credentials and
  Render deployment/env configuration are complete.
