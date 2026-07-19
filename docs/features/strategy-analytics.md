# Strategy Analytics

Strategy Analytics is the historical cohort layer for AI-Trader Version 2. It converts immutable trade reports, daily reports, decision journals, and session records into deterministic cohort statistics.

## Purpose

- Identify which strategies, symbols, sectors, regimes, confidence bands, DTE ranges, delta bands, IV bands, weekdays, and exit reasons have produced better or worse outcomes.
- Surface cohort-level evidence for later missed-opportunity analysis and AI Coach recommendations.
- Keep analytics separate from live execution and separate from Version 1 trading behavior.

## Boundaries

Strategy Analytics does not:

- query brokers
- query market-data providers
- rebuild execution state
- recompute signals or risk decisions
- change GPT prompts
- change Version 1 schemas or APIs

It only consumes persisted evidence.

## Aggregation Window

Supported windows:

- `DAILY`
- `WEEKLY`
- `MONTHLY`
- `ROLLING`

Each window generates one analytics snapshot per `{windowType, tradingDate, environment}` combination.

## Deterministic Ranking Logic

Rankings are built from stored evidence and deterministic aggregation:

- strategy label from persisted strategy markers
- symbol from trade identity
- sector from persisted trade market context when available
- market regime from persisted market context or decision evidence
- confidence bucket from stored confidence values
- DTE, delta, IV, weekday, and time-of-day buckets from persisted trade facts
- exit-reason cohorts from persisted lifecycle evidence
- risk profile from stored decision journal position sizing

No GPT is used.

## Evidence Quality

Every analytics snapshot carries:

- an evidence-completeness score
- missing-evidence labels
- warnings for inconsistent or absent evidence
- references back to the originating session, daily report, trade reports, and decision journal entries

## Backfill

Backfill is explicit and idempotent. It should only be run from the server command or the admin-gated API, never on startup.

Example:

```bash
npm --prefix server run intelligence:backfill-analytics -- 2026-07-16
```

## UI Behavior

The Strategy Analytics page is historical and read-only.

It should show:

- performance summary
- strategy rankings
- underlying rankings
- sector rankings
- market regime cohorts
- confidence cohorts
- DTE / delta / IV cohorts
- weekday and time-of-day cohorts
- exit-reason cohorts
- evidence quality and warnings

When evidence is missing, the page must say so honestly rather than render fake zeroes or placeholders.

## Known Limitations

- Sector attribution depends on what Version 1 persisted.
- Some regimes and market-context fields are only as complete as the upstream daily and trade reports.
- Strategy classification is deterministic but heuristic when the persisted evidence contains multiple strategy markers.

## Handoff

Strategy Analytics is the last evidence layer before missed-opportunity analysis and AI Coach recommendations.
