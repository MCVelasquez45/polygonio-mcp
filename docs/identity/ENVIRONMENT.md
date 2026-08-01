# Identity Environment Variables

## Required For Production

```bash
IDENTITY_JWT_SECRET=<strong-secret-at-least-32-bytes>
IDENTITY_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
IDENTITY_APP_BASE_URL=https://<frontend-domain>
IDENTITY_API_BASE_URL=https://<backend-domain>
IDENTITY_COOKIE_SECURE=true
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=https://<backend-domain>/api/auth/google/callback
GOOGLE_PROJECT_ID=<google-cloud-project-id>
MONGO_URI=<mongodb-uri>
MONGO_OPTIONAL=false
```

Generate secrets:

```bash
openssl rand -base64 48   # IDENTITY_JWT_SECRET
openssl rand -base64 32   # IDENTITY_ENCRYPTION_KEY
```

## Development Defaults

```bash
IDENTITY_APP_BASE_URL=http://localhost:5173
IDENTITY_API_BASE_URL=http://localhost:4000
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
GOOGLE_PROJECT_ID=<google-cloud-project-id>
MONGO_OPTIONAL=true
IDENTITY_EMAIL_PROVIDER=console
```

## Optional Tuning

```bash
IDENTITY_ACCESS_TTL_SEC=900
IDENTITY_REFRESH_TTL_SEC=43200
IDENTITY_REMEMBER_TTL_SEC=2592000
IDENTITY_VERIFY_TTL_SEC=86400
IDENTITY_RESET_TTL_SEC=3600
IDENTITY_RATE_WINDOW_MS=60000
IDENTITY_RATE_MAX=20
IDENTITY_MAX_FAILED_LOGINS=5
IDENTITY_LOCKOUT_MS=900000
```

## Legacy Compatibility

```bash
AI_TRADER_AUTH_ENFORCEMENT=observe
AI_TRADER_AUTH_TOKEN=<optional-static-token>
AI_TRADER_DEFAULT_ACTOR_ID=legacy-operator
AI_TRADER_DEFAULT_ACCOUNT_ID=paper-default
AI_TRADER_DEFAULT_ROLES=administrator
```

Keep `observe` until frontend auth and any operator/worker token paths are
deployed. Set `required` only after staging verification.

`GOOGLE_CALLBACK_URL` is accepted as a compatibility alias for
`GOOGLE_REDIRECT_URI`; `GOOGLE_REDIRECT_URI` wins if both are set.
