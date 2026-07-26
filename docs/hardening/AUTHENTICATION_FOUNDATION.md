# Authentication Foundation

Status: implemented as the v2 staged backend identity foundation.

Authority:

- `docs/architecture/AI_TRADER_V2_MASTER_ARCHITECTURE.md`
- `docs/roadmaps/AI_TRADER_V2_IMPLEMENTATION_BACKLOG.md`
- `docs/architecture/adr/001-strategy-engine-paper-only.md`
- `docs/architecture/adr/002-ai-has-no-direct-order-authority.md`

## Scope

The backend now attaches request identity context to incoming Express requests.
This is the first implementation step for actor attribution, account isolation,
and future RBAC. It is not a complete authentication product and does not add
live trading, autonomous trading, production reinforcement learning, or AI order
authority.

## Runtime Modes

Default mode is observe/compatible mode.

- Unauthenticated requests continue to work.
- `req.auth` is still populated with a legacy-compatible actor context.
- Existing production browser flows remain backward compatible.

Required mode is opt-in.

- Set `AI_TRADER_AUTH_ENFORCEMENT=required` or `AI_TRADER_AUTH_MODE=required`.
- Unsafe `/api` methods require a valid bearer token.
- Unsafe means `POST`, `PUT`, `PATCH`, or `DELETE`.
- `GET`, `HEAD`, and `OPTIONS` requests remain readable during the staged rollout.

If required mode is enabled without a configured token, unsafe `/api` requests
fail closed with `AUTH_CONFIGURATION_REQUIRED`.

## Bootstrap Token

The current bootstrap authenticator accepts:

```text
Authorization: Bearer <configured token>
```

Configuration:

| Variable | Purpose |
| --- | --- |
| `AI_TRADER_AUTH_TOKEN` | Preferred bootstrap bearer token |
| `AI_TRADER_OPERATOR_TOKEN` | Compatibility fallback token |
| `AI_TRADER_DEFAULT_ACTOR_ID` | Legacy fallback actor ID |
| `AI_TRADER_DEFAULT_ACCOUNT_ID` | Legacy fallback paper account ID |
| `AI_TRADER_DEFAULT_ROLES` | Comma-separated fallback roles |

Do not commit the actual token value.

## Actor Headers

When the bearer token is valid, these optional headers can identify the request
actor and paper account:

| Header | Purpose |
| --- | --- |
| `X-AI-Trader-Actor-Id` | Actor identifier for attribution |
| `X-AI-Trader-Account-Id` | Paper account identifier |
| `X-AI-Trader-Roles` | Comma-separated role names for future RBAC |

Current recognized roles are:

- `viewer`
- `trader`
- `operator`
- `administrator`

RBAC enforcement is intentionally deferred to `V2-BL-004`.

## Request Context

Routes can read:

```ts
req.auth
```

The context contains:

- `authenticated`
- `actorId`
- `accountId`
- `roles`
- `authMethod`
- `enforcementMode`

This context is the starting point for durable event actor attribution in later
v2 foundation work.

## Current Protections

- Required mode blocks unauthenticated unsafe `/api` requests.
- Missing auth configuration fails closed in required mode.
- Token comparison uses constant-time comparison for equal-length candidates.
- Logs record rejection reason, actor ID, and account ID without logging token
  values.
- CORS allows the auth and actor-attribution headers needed for staged rollout.

## Explicit Non-Goals

This implementation does not provide:

- User registration or user management.
- OAuth or SSO.
- Session cookies.
- CSRF policy.
- RBAC enforcement.
- Route-level role matrix.
- Multi-account automation.
- Live-money execution.

Those belong to later approved backlog items.

## Rollback

Operational rollback:

1. Remove or unset `AI_TRADER_AUTH_ENFORCEMENT=required`.
2. Leave default observe mode active while investigating.

Code rollback:

1. Remove the request identity middleware wiring from `server/src/index.ts`.
2. Remove `server/src/shared/auth/requestIdentity.ts`.
3. Remove `server/tests/auth.foundation.test.mjs`.

## Verification

Required tests:

- Unauthenticated unsafe `/api` request rejects in required mode.
- Missing configured token fails closed in required mode.
- Valid bearer token propagates actor/account identity.
- Read-only `/api` requests remain compatible.
- Observe mode does not block legacy state-changing requests.
- Enforcement is scoped to `/api` routes.
