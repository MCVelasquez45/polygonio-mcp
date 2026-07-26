# Vercel Frontend Observability

AI-Trader Enterprise uses Vercel native frontend observability for the Vite React client in `client/`.

This setup is additive. It does not change trading logic, execution ownership, broker integrations, market-data integrations, or autonomous system behavior.

## Architecture

The React application root is `client/src/main.tsx`.

The root mounts exactly one Vercel Web Analytics component and exactly one Speed Insights component:

```tsx
<Analytics />
<SpeedInsights />
```

The application also uses `client/src/lib/operatorAnalytics.ts` for anonymous custom events. That utility wraps Vercel Analytics `track()` and exposes an allowlisted event catalog.

## Analytics

Package:

```bash
npm --prefix client install @vercel/analytics
```

Root integration:

```tsx
import { Analytics } from '@vercel/analytics/react';
```

Vercel Web Analytics automatically tracks page views after the project is deployed and Web Analytics is enabled in the Vercel dashboard.

## Speed Insights

Package:

```bash
npm --prefix client install @vercel/speed-insights
```

Root integration:

```tsx
import { SpeedInsights } from '@vercel/speed-insights/react';
```

Speed Insights reports Core Web Vitals and route-level frontend performance after production traffic reaches the deployed Vercel project.

## Observability

Native Vercel Observability is used for frontend deployments:

- Deployments and build logs
- Runtime logs for Vercel-handled routes and functions
- Request and routing telemetry
- Web Analytics page views and custom events
- Speed Insights performance metrics
- Vercel traces where supported by the project plan and runtime

The AI-Trader backend remains on Render. Backend runtime logs, schedulers, workers, MongoDB connectivity, Massive connectivity, Alpaca connectivity, and execution traces are monitored through the backend health/status APIs and Render logs.

No third-party monitoring service is required for this task.

## Tracked Events

Custom events are intentionally anonymous and operator-workflow focused:

- Application Loaded
- Automation Viewed
- Automation Started
- Automation Stopped
- Cockpit Viewed
- AI Desk Viewed
- Strategy Viewed
- Risk Viewed
- Trade Lifecycle Viewed
- Reports Viewed
- Operator Expanded Advanced Details
- Shadow Mode Enabled
- Paper Mode Enabled

These events may include only coarse UI properties such as:

- `surface`: `desktop` or `mobile`
- `control`: `pause`, `resume`, or `emergency-stop`
- `section`: the UI section label

## Privacy

Never send these values to Vercel Analytics custom events:

- Broker account IDs
- User emails
- API keys
- JWTs
- Tokens
- Secrets
- Personally identifiable information
- Trade prices
- Order IDs
- Contract IDs
- Raw provider payloads

The analytics utility only exists for UI workflow events. Do not use it from trading, broker, market-data, risk, lifecycle, or execution logic.

## Deployment

No deployment is performed by this setup.

Before deployment:

```bash
npm run lint
npm run build
npm --prefix client test
```

Vercel project settings to confirm:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Web Analytics: enabled
- Speed Insights: enabled
- Observability: enabled for the project/team plan

The repository `client/vercel.json` keeps same-origin rewrites for `/api/*`, `/health`, and `/socket.io/*`.

## Verification

After production deployment and real traffic:

1. Open the Vercel project dashboard.
2. Confirm Web Analytics is detected.
3. Confirm Speed Insights is detected.
4. Confirm page views start populating.
5. Confirm route views appear for the deployed Vite app.
6. Confirm Speed Insights begins reporting Core Web Vitals.
7. Confirm Observability shows deployment logs and request telemetry.
8. Exercise the Automation workspace and confirm custom events begin appearing.

Expected delay: analytics and performance dashboards may need production traffic and processing time before data appears.

## Troubleshooting

If Web Analytics is not detected:

- Confirm `@vercel/analytics` is installed in `client/package.json`.
- Confirm exactly one `<Analytics />` is mounted in `client/src/main.tsx`.
- Confirm Web Analytics is enabled in the Vercel dashboard.
- Confirm the deployed build is the latest commit.

If Speed Insights is not detected:

- Confirm `@vercel/speed-insights` is installed in `client/package.json`.
- Confirm exactly one `<SpeedInsights />` is mounted in `client/src/main.tsx`.
- Confirm Speed Insights is enabled in the Vercel dashboard.
- Confirm production traffic has reached the site.

If custom events do not appear:

- Confirm events are emitted from `client/src/lib/operatorAnalytics.ts`.
- Confirm the event name is in `OPERATOR_ANALYTICS_EVENTS`.
- Confirm the interaction occurred in a production deployment.
- Confirm no browser extension is blocking analytics scripts.

If runtime logs or traces are missing:

- Confirm the project has Vercel Observability enabled.
- Confirm the route is handled by Vercel rather than the Render backend rewrite.
- Use Render logs and `/api/system/status` for backend runtime observability.
