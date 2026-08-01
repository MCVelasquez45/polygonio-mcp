# OAuth Redirect Checklist

Use exact origins and exact callback URLs. Google compares redirect URIs
literally.

## Local Development

- Frontend origin: `http://localhost:5173`
- Backend callback: `http://localhost:4000/api/auth/google/callback`
- Backend env:
  - `IDENTITY_APP_BASE_URL=http://localhost:5173`
  - `IDENTITY_API_BASE_URL=http://localhost:4000`
  - `GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback`

## Render Backend

- Authorized redirect URI:
  - `https://<render-service>.onrender.com/api/auth/google/callback`
- Backend env:
  - `IDENTITY_API_BASE_URL=https://<render-service>.onrender.com`
  - `GOOGLE_REDIRECT_URI=https://<render-service>.onrender.com/api/auth/google/callback`

## Vercel Frontend

- Authorized JavaScript origin:
  - `https://<vercel-app>.vercel.app`
- Backend env:
  - `IDENTITY_APP_BASE_URL=https://<vercel-app>.vercel.app`
- Client env:
  - `VITE_API_BASE_URL` and `VITE_SOCKET_URL` should be same-origin or omitted
    for production proxy builds, per `client/.env.example`.

## Production Custom Domain

- Frontend origin:
  - `https://<frontend-domain>`
- Backend callback:
  - `https://<backend-domain>/api/auth/google/callback`
- Backend env:
  - `IDENTITY_APP_BASE_URL=https://<frontend-domain>`
  - `IDENTITY_API_BASE_URL=https://<backend-domain>`
  - `GOOGLE_REDIRECT_URI=https://<backend-domain>/api/auth/google/callback`
  - `IDENTITY_COOKIE_SECURE=true`

## Future Staging

For each staging environment, register both:

- JavaScript origin: `https://<staging-frontend-domain>`
- Redirect URI: `https://<staging-backend-domain>/api/auth/google/callback`

Do not reuse production redirect URIs for staging unless frontend and backend
domains are also production.
