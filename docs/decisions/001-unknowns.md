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

## Adopted Decisions (ADRs)

*No decisions recorded yet.*
