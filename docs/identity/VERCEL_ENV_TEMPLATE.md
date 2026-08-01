# Vercel Identity Environment Template

Use this for the `polygonio-mcp-beryl` Vercel frontend project.

The production bundle should call same-origin `/api/*` and `/socket.io*`
through `client/vercel.json` rewrites. Do not embed the Render backend URL in
the browser bundle for the standard production deployment.

```bash
VITE_API_BASE_URL=https://polygonio-mcp-beryl.vercel.app
VITE_SOCKET_URL=https://polygonio-mcp-beryl.vercel.app
VITE_APP_ENV=production
```

Local development:

```bash
VITE_API_BASE_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
VITE_APP_ENV=development
```

No frontend OAuth secret is required. Google OAuth uses the backend
Authorization Code Flow and server-side client secret.
