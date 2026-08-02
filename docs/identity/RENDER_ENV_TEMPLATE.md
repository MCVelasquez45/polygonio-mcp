# Render Identity Environment Template

Use this for the `polygonio-backend` Render service. Values shown in angle
brackets are placeholders; store real secrets only in Render.

```bash
NODE_ENV=production
MONGO_OPTIONAL=false
MONGO_URI=<mongo-atlas-uri>

CORS_ORIGINS=https://polygonio-mcp-beryl.vercel.app
FRONTEND_ORIGIN=https://polygonio-mcp-beryl.vercel.app

IDENTITY_JWT_SECRET=<strong-random-secret>
IDENTITY_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
IDENTITY_APP_BASE_URL=https://polygonio-mcp-beryl.vercel.app
IDENTITY_API_BASE_URL=https://polygonio-backend.onrender.com
IDENTITY_COOKIE_SECURE=true

GOOGLE_PROJECT_ID=ai-trading-auth
GOOGLE_CLIENT_ID=<google-oauth-web-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-web-client-secret>
GOOGLE_REDIRECT_URI=https://polygonio-backend.onrender.com/api/auth/google/callback
GOOGLE_CALLBACK_URL=https://polygonio-backend.onrender.com/api/auth/google/callback

IDENTITY_EMAIL_PROVIDER=console
```

Existing trading, market data, broker, AI, and agent variables remain unchanged.
Do not print `GOOGLE_CLIENT_SECRET`, `MONGO_URI`, broker keys, or API keys in
logs.
