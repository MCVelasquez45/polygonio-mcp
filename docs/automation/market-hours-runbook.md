# Market-Hours Runbook

Automation entries run **only** during the official regular US options session,
using the **Alpaca broker clock** as the authority (never server-local time).
Holidays and early closes are handled automatically because every phase is
derived from the broker clock's `next_close`.

## Daily timeline (minutes before the authoritative close)

| Time | Phase | What automation does |
|---|---|---|
| Open → T‑45 | `PRE_CUTOFF` | evaluate options-flow windows, submit approved entries |
| T‑45 → T‑20 | `POST_ENTRY_CUTOFF` | no new entries; monitor open positions |
| T‑20 → T‑15 | `CANCEL_ENTRIES` | cancel unfilled entry orders; keep monitoring |
| T‑15 → close | `FLATTEN` | submit exits for every automation position |
| Closed | `CLOSED` | no entries/ordinary exits; reconciliation + health continue |

Cutoffs are configurable: `AUTOMATION_FINAL_ENTRY_MINUTES_BEFORE_CLOSE` (45),
`AUTOMATION_CANCEL_ENTRY_ORDERS_MINUTES_BEFORE_CLOSE` (20),
`AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE` (15). Ordering is validated at startup
(final ≥ cancel ≥ flatten > 0).

## End-of-day flattening

1. Cancel unfilled automation entry orders; reconcile cancellation.
2. Submit deterministic `END_OF_DAY` exits for every automation-owned position.
3. Reconcile until closed, or until the broker reports an unresolved state.
4. If a position cannot be confirmed closed → **pause the session** and raise a
   critical Portfolio alert. No position intentionally remains overnight.

## Outside market hours

No new entries and no ordinary new exit orders. Any unresolved position stays
prominently flagged for manual attention and is reconciled at the next
authorized session. Reconciliation and health checks continue; the Portfolio
remains visible.

## Scheduler ownership

A database-backed lease guarantees a single scheduler owner. A second process
cannot acquire a held lease, so the same trade can never be submitted twice.
After a crash the lease expires and is reclaimed on the next tick. The scheduler
starts only after startup reconciliation succeeds and re-reconciles before
resuming after any restart.
