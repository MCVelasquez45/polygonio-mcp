# State Diagram

```text
NEW
  |
PENDING_ENTRY
  |
ENTRY_SUBMITTED
  |
ENTRY_FILLED
  |
MONITORING
  |
PARTIAL_EXIT
  |
EXIT_PENDING
  |
EXIT_FILLED
  |
EVALUATION
  |
ARCHIVED
```

State transitions are persisted one at a time in `trade_lifecycle_journal`.
