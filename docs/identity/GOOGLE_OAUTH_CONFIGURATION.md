# Google OAuth Configuration Report

Status: **blocked on Console-owned OAuth configuration and production deployment.**

This report covers AI-Trader V3 Phase 1.5 Google OAuth infrastructure. No new
authentication feature code was added. The existing Identity Platform remains
the source of truth.

## 1. Local SDK Verification

Verified commands:

```bash
gcloud version
gcloud auth login
gcloud auth list
gcloud config list
gcloud projects list --format="table(projectId,name,projectNumber,lifecycleState)"
gcloud config set project ai-trading-auth
```

Result:

```text
Google Cloud SDK 578.0.0
Authenticated account: mcvelasquez45@gmail.com
Active project: ai-trading-auth
Project name: Ai-trading-Auth
Project number: 768973950716
Lifecycle state: ACTIVE
```

No duplicate project was created. OAuth consent screen and OAuth web client
settings still require Google Cloud Console interaction.

## 2. Actual Project URLs Discovered In Repo

Frontend:

```text
https://polygonio-mcp-beryl.vercel.app
```

Backend:

```text
https://polygonio-backend.onrender.com
```

Agent service, not used for OAuth:

```text
https://polygonio-agent.onrender.com
```

No production custom frontend domain was found in the repository. Do not add a
custom domain to Google OAuth until the domain is actually assigned to the
project.

## 3. Required OAuth APIs and Scopes

The current backend uses `google-auth-library` for Authorization Code exchange
and ID token verification. It does not call Google People API.

Required OAuth scopes:

```text
openid
email
profile
```

People API:

```text
Not required by current implementation.
```

Do not enable or request additional APIs/scopes unless a future implementation
actually calls them.

Useful verification commands:

```bash
gcloud services list --enabled --project ai-trading-auth
gcloud services list --available --filter="name:people.googleapis.com" --project ai-trading-auth
```

OAuth consent and OAuth clients are primarily configured under APIs & Services
in the Google Cloud Console. There is no repo evidence that additional Google
runtime APIs are required for this OAuth code path.

## 4. OAuth Consent Screen Requirements

Configure in Google Cloud Console:

```text
Application name: AI-Trader
Support email: <operator/support email>
Developer contact email: <operator/security email>
Publishing status: Testing until verified, then Production
User type: External unless restricted to a Google Workspace organization
Scopes: openid, email, profile only
```

Manual Console URL:

```text
https://console.cloud.google.com/apis/credentials/consent?project=ai-trading-auth
```

## 5. OAuth Client Requirements

Create or verify one OAuth 2.0 **Web application** client.

Never print the client secret into logs or commit it to the repository.

Manual Console URL:

```text
https://console.cloud.google.com/apis/credentials?project=ai-trading-auth
```

## 6. Authorized JavaScript Origins

Configure only these discovered/required origins:

```text
http://localhost:5173
http://localhost:4173
http://localhost:4000
https://polygonio-mcp-beryl.vercel.app
```

Do not add:

```text
*
https://*.vercel.app
http://<production-domain>
```

Custom domain:

```text
Not configured because no actual custom domain was found in repo.
```

## 7. Authorized Redirect URIs

Configure only these callback URIs:

```text
http://localhost:4000/api/auth/google/callback
https://polygonio-backend.onrender.com/api/auth/google/callback
```

Do not add the Vercel frontend URL as a redirect URI for the current backend
Authorization Code Flow. The callback terminates on Express/Render, sets
session cookies, and redirects back to the frontend.

## 8. Backend Environment Variable Checklist

Render backend must have:

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
MONGO_URI=<mongo-atlas-uri>
MONGO_OPTIONAL=false
```

Compatibility:

```bash
GOOGLE_CALLBACK_URL=https://polygonio-backend.onrender.com/api/auth/google/callback
```

`GOOGLE_REDIRECT_URI` is canonical and takes precedence if both redirect
variables are set.

## 9. Existing OAuth Implementation Review

Reviewed files:

```text
server/src/features/identity/identity.routes.ts
server/src/features/identity/services/oauthService.ts
server/src/features/identity/services/userService.ts
server/src/features/identity/services/sessionService.ts
server/src/shared/identity/oauthState.ts
server/src/shared/identity/config.ts
server/src/shared/identity/cookies.ts
server/src/shared/identity/csrf.ts
client/src/auth/authApi.ts
client/src/auth/AuthContext.tsx
client/src/auth/AuthScreen.tsx
```

Verified:

- Authorization Code Flow is implemented.
- No Implicit Flow is implemented.
- Google ID token is verified with `google-auth-library`.
- Audience is checked against `GOOGLE_CLIENT_ID`.
- Google email must exist and be verified.
- Existing account linking is supported by provider subject, then verified email.
- OAuth-only new user creation is supported.
- Duplicate provider link prevention is implemented.
- Session creation uses the existing refresh-token session service.
- Refresh token is stored as a SHA-256 hash in Mongo.
- Refresh cookie is HttpOnly.
- CSRF cookie/header double-submit exists for cookie-authenticated POSTs.
- Signed state exists and allows only relative return paths.
- Open redirects are blocked by relative-path normalization.
- Logout and logout-all revoke sessions.
- Session restore uses `/api/auth/refresh`.

Security issue documented:

- The code uses a signed state value, but does not currently persist or verify a
  server-side one-time nonce. The state is tamper-resistant and time-limited,
  but not single-use. Refresh-token rotation still protects sessions after
  issuance. Consider one-time OAuth state storage if the threat model requires
  replay rejection before code exchange.
- The generated state payload contains a nonce for state uniqueness, but the
  current Authorization Code Flow does not send an OIDC `nonce` parameter to
  Google or validate a `nonce` claim on the ID token.
- Authorization Code Flow currently does not use PKCE. For confidential web
  server clients this is acceptable, but adding PKCE would be a hardening
  improvement if Google and the existing handler are extended later.

No duplicate handlers should be created.

## 10. Production Validation Checklist

After Google Console and Render env are configured:

1. Open `https://polygonio-mcp-beryl.vercel.app`.
2. Click **Continue with Google**.
3. Confirm Google consent screen shows app name `AI-Trader`.
4. Confirm requested scopes are only `openid`, `email`, `profile`.
5. Complete login.
6. Confirm browser returns through:

```text
https://polygonio-backend.onrender.com/api/auth/google/callback
```

7. Confirm final page is the AI-Trader dashboard.
8. Confirm `/api/auth/me` returns the Google user.
9. Confirm Mongo has:
   - `identity_users` row
   - linked `oauth.provider=google`
   - active `identity_sessions` row
   - audit log `GOOGLE_LOGIN`
10. Logout.
11. Reload and confirm logged-out state.
12. Login again with the same Google email and verify no duplicate user is
    created.
13. Register an email/password account with the same email, then sign in with
    Google and verify the provider links to the existing user.
14. Reload dashboard and verify session restore.
15. Wait for access-token expiry and verify refresh rotation still works.

## 11. Troubleshooting

`redirect_uri_mismatch`

- The exact callback URI is missing from the OAuth client.
- Add:

```text
https://polygonio-backend.onrender.com/api/auth/google/callback
```

`GOOGLE_OAUTH_NOT_CONFIGURED`

- Render is missing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or callback env.

Login succeeds at Google but dashboard shows signed out:

- Check `IDENTITY_APP_BASE_URL`.
- Check cookies are `Secure` in production.
- Check frontend origin is present in `CORS_ORIGINS` and `FRONTEND_ORIGIN`.

Cookie not set:

- Ensure backend is HTTPS.
- Ensure `IDENTITY_COOKIE_SECURE=true`.
- Ensure the request terminates on Render backend callback, not Vercel.

Duplicate users:

- Confirm Google email is verified.
- Confirm `identity_users.email` is lowercase and unique.
- Confirm OAuth client ID belongs to the same intended project.

## 12. Remaining Blockers

1. OAuth consent screen cannot be verified or configured from `gcloud`.
2. OAuth web client cannot be verified or created from `gcloud`.
3. Client ID/secret cannot be generated or inspected until Console setup is
   complete.
4. Render currently returns `404` for `/api/auth/config`, indicating the
   deployed backend does not yet expose the Identity Platform routes.
5. Render environment variables cannot be verified from this workspace.
6. Production Google login cannot be tested until the above are complete.

## 13. Manual Console URLs

Generic Console URLs:

```text
https://console.cloud.google.com/apis/credentials/consent
https://console.cloud.google.com/apis/credentials
```

Project-qualified URLs:

```text
https://console.cloud.google.com/apis/credentials/consent?project=ai-trading-auth
https://console.cloud.google.com/apis/credentials?project=ai-trading-auth
```
