# Autonomous Trading Architecture

The coordinator is additive orchestration only. It preserves this authority chain:

```text
Massive Market Data
  -> Event Intelligence
  -> Decision Intelligence
  -> Strategy Orchestrator
  -> Enterprise Risk Engine
  -> Trade Lifecycle Manager
  -> Existing Execution Gateway
  -> Alpaca Paper Trading
  -> Existing Trade Evaluation
  -> Journals and Reports
```

## Boundaries

- Event Intelligence detects and explains market events.
- Decision Intelligence identifies and ranks opportunities.
- Strategy Orchestrator selects and compares strategies.
- Risk Engine approves or rejects recommendations.
- Trade Lifecycle Manager owns approved trades from entry through evaluation.
- Execution Gateway submits and manages broker orders.
- Alpaca Paper provides broker truth.
- Trade Evaluation measures completed outcomes.

No AI component calls Alpaca directly. No upstream intelligence component executes orders. No trade may reach the Execution Gateway without a current Risk Engine approval package.

## New Additive Module

Server location:

```text
server/src/features/autonomousTrading/
```

Important files:

- `contracts/pipelineContract.ts`
- `contracts/entryGate.ts`
- `coordinator/autonomousCoordinator.service.ts`
- `state/pipelineStateMachine.ts`
- `shadow/shadowExecutionAdapter.ts`
- `storage/autonomousPipeline.model.ts`
- `routes/autonomousTrading.routes.ts`

