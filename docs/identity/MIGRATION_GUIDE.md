# Identity Migration Guide

Phase 1 is additive. Existing trading collections and trading engine behavior
are not migrated or rewritten.

1. Deploy backend with `AI_TRADER_AUTH_ENFORCEMENT=observe`.
2. Configure Mongo and identity secrets.
3. Start the backend once. `runIdentityMigrations()` seeds `identity_roles`.
4. Register the first account. The first user becomes `admin`.
5. Verify email through the console email provider or production email provider.
6. Sign in with email/password and confirm `/api/auth/me` succeeds.
7. Configure Google OAuth and confirm a Google sign-in links to the same email
   when the email already exists.
8. Verify existing trading routes still operate in observe mode.
9. Update worker/operator traffic to send either a valid identity access token
   or the retained static token.
10. Flip `AI_TRADER_AUTH_ENFORCEMENT=required` in staging.
11. Run route protection and trading regression tests.
12. Promote to production.

Rollback is simple in Phase 1: set `AI_TRADER_AUTH_ENFORCEMENT=observe` again.
Identity collections can remain in Mongo; existing trading collections are
unaffected.
