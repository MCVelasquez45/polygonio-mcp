# Options Feature

Owns option-specific analytics and caches consumed by the UI:
- `services/optionsChecklist.ts`: builds entry checklist reports (EMA, VWAP, sentiment, etc.).
- `services/watchlistReports.ts`: aggregates per-symbol highlights for scanner/watchlist.
- `services/optionsChainStore.ts`: caches option chain snapshots.
- `services/selectionStore.ts`: persists the user's last-selected contract.

This module shares aggregate storage utilities from `../market/services/aggregatesStore` and database helpers under `src/shared/db`.
