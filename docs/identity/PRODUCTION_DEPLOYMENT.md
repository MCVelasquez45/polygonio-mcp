# Production Deployment Guide

## Backend

Set on Render or the backend host:

```bash
NODE_ENV=production
MONGO_URI=<mongodb-uri>
MONGO_OPTIONAL=false
CORS_ORIGINS=https://<frontend-domain>
FRONTEND_ORIGIN=https://<frontend-domain>
IDENTITY_JWT_SECRET=<secret>
IDENTITY_ENCRYPTION_KEY=<base64-32-byte-key>
IDENTITY_APP_BASE_URL=https://<frontend-domain>
IDENTITY_API_BASE_URL=https://<backend-domain>
IDENTITY_COOKIE_SECURE=true
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_REDIRECT_URI=https://<backend-domain>/api/auth/google/callback
GOOGLE_PROJECT_ID=<google-cloud-project-id>
```

Keep `AI_TRADER_AUTH_ENFORCEMENT=observe` for the first production rollout.
Move to `required` only after session restore, Google OAuth, websocket auth, and
operator flows are verified.

## Frontend

Local development uses:

```bash
VITE_API_BASE_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
```

For hosted Vercel production, keep requests same-origin through rewrites. Do not
embed the Render backend origin in the frontend bundle.

## Email Provider

Phase 1 ships `IDENTITY_EMAIL_PROVIDER=console`. Add Resend, SendGrid, or SMTP
by implementing `EmailProvider` in `server/src/features/identity/services/emailService.ts`.
Business logic already depends only on that interface.

## Smoke Checks

1. `GET /api/auth/config` returns `googleConfigured: true`.
2. `GET /api/auth/csrf` sets `id_csrf`.
3. Register and verify a new user.
4. Login returns an access token and sets `id_refresh` as HttpOnly.
5. Reload frontend; session restores through `/api/auth/refresh`.
6. Socket connects with authenticated handshake.
7. `GET /api/auth/workspace` returns the default organization, membership,
   watchlist seed, AI memory seed, journal seed, and broker onboarding
   placeholders.
8. Profile menu shows Connect Broker placeholders for Alpaca, Tradier, IBKR,
   Tastytrade, and Paper without prompting during signup.
9. Logout clears cookies and protected routes return `401`.
