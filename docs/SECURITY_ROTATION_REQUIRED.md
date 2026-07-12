# Security Rotation Required

This repository previously contained real-looking credentials in example environment files. Treat every credential that may have been copied into the repository, local clones, logs, screenshots, or build systems as compromised.

Do not paste actual secrets into this document, issues, pull requests, chat, commit messages, or example files.

## Rotate Immediately

- Massive / Polygon API keys used for REST market data and WebSocket streaming.
- Alpaca API key IDs, secret keys, paper trading credentials, and any live trading credentials.
- OpenAI API keys, transcription keys, SIFT provider keys, and assistant IDs where applicable.
- MongoDB connection strings, usernames, passwords, and Atlas database users.
- GitHub personal access tokens or automation tokens.
- FRED API keys.
- Nasdaq Data Link / Quandl API keys.
- Databento API keys.
- Anthropic API keys used by examples.
- Notification or command webhook URLs, including Chip command or notify endpoints.
- Any other API key, bearer token, webhook URL, database URI, or service credential that appeared in local `.env` files or repo history.

## Required Response

1. Revoke the old credentials in each provider console.
2. Create replacement credentials with least-privilege scopes.
3. Store replacements only in local `.env` files, deployment secret stores, or approved secret managers.
4. Confirm `.env` and `.env.*` files remain ignored.
5. Run a secret scan against the working tree and full Git history.
6. Purge exposed values from Git history with an approved history rewrite process before sharing this repository externally.
7. Invalidate or re-clone developer worktrees after history is rewritten.

## Safe Local Setup

- Copy the relevant `.env.example` file to `.env`.
- Replace placeholder values locally.
- Never commit `.env`, `.env.*`, shell history exports, screenshots, or logs that include credentials.
- Use short-lived development auth tokens only outside production.

## Production Requirements

- Use a managed secret store for all provider credentials.
- Disable `AUTH_ALLOW_DEV_TOKENS` in production.
- Set `AUTH_JWT_SECRET` to a high-entropy value or replace HS256 validation with the production identity provider's JWKS validation.
- Use separate credentials for market data, paper trading, live trading, CI, and local development.
- Keep live Alpaca credentials outside local development environments until broker safety controls are complete.

