# Decision Log & Unknowns

This directory tracks the "Unknowns" and architectural decisions for the project. 

## Active Unknowns

### [001] Open Questions (Created: 2026-01-15)

**1. Data Persistence Strategy**
- **Status**: UNKNOWN
- **Question**: We are using MongoDB. Is it running locally? Do we need a cloud instance?
- **Context**: `ARCHITECTURE.md` mentions "Ring Buffer (In-memory to start; Redis later)". When do we switch to Redis?

**2. Shared Data Models**
- **Status**: UNKNOWN
- **Question**: How do we share types between the Client (TS), Server (TS), and Screener (Python)?
- **Context**: `Candle` and `Opportunity` types are redefined in multiple places. mismatches will cause bugs.

**3. Agent Authentication**
- **Status**: UNKNOWN
- **Question**: How do we secure the Agent API?
- **Context**: Currently it runs on port 5001. If we deploy, anyone can hit it.

**4. Real-time Equity Data Cost**
- **Status**: UNKNOWN
- **Question**: Polygon streams for equities can be expensive or have concurrency limits. What is our budget/limit?

**5. Data sources for Futures**
- **Status**: **BLOCKED (WAF Issues)**
- **Current Approach**: Quandl (Nasdaq Data Link) - Implemented but Failing.
- **Context**: 
    - **Implementation**: Added `FuturesDataFetcher` using Quandl's free tier for daily OHLCV.
    - **Critical Issue**: Nasdaq's Incapsula WAF is blocking requests from the current cloud IP environment (HTTP 403 Forbidden), despite correct API keys and User-Agent headers.
    - **Impact**: Unable to retrieve futures data in the current hosting environment.
    - **Recommended Next Steps**:
        1. **Pivot to Databento**: Offers usage-based pricing and is known to be friendlier to cloud environments.
        2. **Use Proxy/VPN**: Route Quandl requests through a residential proxy (adds complexity).
    - **Alternatives Evaluated**:
        - **Quandl**: Free, but blocked by WAF.
        - **Databento**: Best for intraday/tick data, pay-as-you-go pricing, cloud-friendly.
        - **CME Group**: Official source, but potentially higher cost/subscription.
    - **Source References**: [1] quantstart.com [2] databento.com [3] cmegroup.com

**6. Node.js 24 + MongoDB Atlas SSL Incompatibility**
- **Status**: **WORKAROUND AVAILABLE**
- **Issue**: Node.js 24.x (with OpenSSL 3.x) has stricter TLS defaults that cause `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` when connecting to MongoDB Atlas.
- **Error**: `ssl3_read_bytes:tlsv1 alert internal error`
- **Context**: 
    - Node 24 is bleeding-edge/experimental (not officially released)
    - OpenSSL 3.x has stricter cipher requirements that break Atlas handshake
- **Workarounds**:
    1. **Downgrade to Node 20 LTS** (recommended): `nvm use 20`
    2. **Use legacy provider**: `NODE_OPTIONS="--openssl-legacy-provider" npm run dev`
- **Resolution**: Created `.nvmrc` file pinning project to Node 20. Future team members should run `nvm use` before starting.
- **Date**: 2026-01-16

## Adopted Decisions (ADRs)

*No decisions recorded yet.*

