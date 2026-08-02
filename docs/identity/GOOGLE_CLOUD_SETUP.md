# Google Cloud Setup

## Console Steps

1. Create or select the existing Google Cloud project for AI-Trader.
2. Open **APIs & Services > OAuth consent screen**.
3. Choose **External** unless this is a Google Workspace-only deployment.
4. Configure app branding:
   - App name: `AI-Trader`
   - User support email: your operator/support email
   - Authorized domains: your production frontend domain, plus any custom domain
     that is already assigned to the project
5. Add scopes:
   - `openid`
   - `email`
   - `profile`
6. Add test users while the consent app is in testing.
7. Open **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
8. Choose **Web application**.
9. Add authorized JavaScript origins:
   - `http://localhost:5173`
   - `http://localhost:4173`
   - `https://polygonio-mcp-beryl.vercel.app`
   - any real staging frontend origin
10. Add authorized redirect URIs:
   - `http://localhost:4000/api/auth/google/callback`
   - `https://polygonio-backend.onrender.com/api/auth/google/callback`
   - any real staging backend callback
11. Copy the client ID and client secret into backend environment variables.

## Google Cloud SDK Commands

```bash
gcloud auth login
gcloud projects list --format="table(projectId,name,projectNumber,lifecycleState)"
gcloud config set project ai-trading-auth
gcloud services list --enabled --project ai-trading-auth
```

Do not create a duplicate project if `ai-trading-auth` is available. Google
OAuth client creation and consent branding are completed in the Cloud Console;
Google does not expose the standard public OAuth web client and every consent
branding field as a stable `gcloud` command. There is no separate
`oauth2.googleapis.com` service to enable for this server-side Authorization
Code Flow. The current backend does not call People API.

## Required Backend Environment

```bash
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
GOOGLE_PROJECT_ID=ai-trading-auth
```

Production:

```bash
GOOGLE_REDIRECT_URI=https://polygonio-backend.onrender.com/api/auth/google/callback
IDENTITY_APP_BASE_URL=https://polygonio-mcp-beryl.vercel.app
IDENTITY_API_BASE_URL=https://polygonio-backend.onrender.com
GOOGLE_PROJECT_ID=ai-trading-auth
```
