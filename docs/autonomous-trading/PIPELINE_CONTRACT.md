# Pipeline Contract

The canonical record is `AutonomousTradePipelineRecord`, schema version `1`.

It traces one opportunity through:

- event context
- decision context
- strategy context
- risk context
- lifecycle context
- execution context
- evaluation context
- append-only timeline

The coordinator stores identifiers and summaries. It does not copy full subsystem records unnecessarily.

## Required Identity

```json
{
  "pipelineId": "atp_...",
  "schemaVersion": 1,
  "mode": "SHADOW",
  "state": "RISK_REJECTED",
  "executionSource": "SHADOW_SIMULATION",
  "symbol": "OXY",
  "optionContract": "O:OXY260724C00060000",
  "idempotencyKey": "atp_..."
}
```

`pipelineId` is deterministic from mode, symbol, event IDs, decision scan ID, strategy run ID, and recommendation package ID. Reprocessing the same recommendation updates the same record.

## Pipeline States

```text
OBSERVING
EVENT_DETECTED
OPPORTUNITY_IDENTIFIED
STRATEGY_SELECTED
RISK_REVIEW
RISK_REJECTED
RISK_APPROVED
LIFECYCLE_CREATED
ENTRY_BLOCKED
ENTRY_REQUESTED
ENTRY_SUBMITTED
ENTRY_FILLED
MONITORING
EXIT_RECOMMENDED
EXIT_REQUESTED
EXIT_FILLED
EVALUATING
COMPLETED
FAILED
CANCELLED
```

Every transition is validated by `pipelineStateMachine.ts` and represented as a timestamped timeline event with actor, reason, reason code, and related record IDs.

