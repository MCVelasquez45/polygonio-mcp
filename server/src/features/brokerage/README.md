# Brokerage Connection Platform

This module sits on top of the permanent Identity Platform. It uses the existing
access-token middleware, CSRF cookie, workspace membership, audit log, and
AES-256-GCM envelope encryption; it does not issue user sessions or identity
tokens.

Customer brokerage connections are OAuth-only. Authorization attempts use a
one-time, ten-minute state record and PKCE. Access and refresh tokens are
encrypted before Mongo persistence and excluded from normal Mongoose queries.
Callbacks immediately import account balances, positions, option positions,
open orders, watchlists, and account configuration into `broker_portfolios`.

`broker_connections` is account-scoped rather than provider-scoped, allowing
multiple accounts per provider and multiple providers per workspace. The
refresh worker renews credentials five minutes before expiration. Disconnect
attempts provider revocation when configured, then deletes encrypted tokens and
portfolio caches while preserving the workspace, AI memory, journal,
strategies, watchlists, and notifications.

Provider OAuth registration is environment-driven; see `server/.env.example`.
A provider fails closed when its OAuth application or the identity encryption
key is not configured.
