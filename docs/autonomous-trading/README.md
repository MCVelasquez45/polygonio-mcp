# Autonomous Trading Integration

This package connects the existing Event Intelligence, Decision Intelligence, Strategy Orchestrator, Risk Engine, Trade Lifecycle Manager, Execution Gateway, Alpaca Paper integration, and Trade Evaluation systems into one traceable paper-trading workflow.

It does not replace any underlying subsystem. The autonomous coordinator stores references to existing records and presents one operator view in the existing Automation/Cockpit workspace.

## Documentation

- `ARCHITECTURE.md` - subsystem boundaries and data flow
- `PIPELINE_CONTRACT.md` - canonical pipeline record
- `OPERATING_MODES.md` - Manual, Shadow, and Autonomous Paper modes
- `OPERATOR_GUIDE.md` - daily operator guide and checklist
- `SHADOW_MODE.md` - simulated execution behavior
- `FAILURE_HANDLING.md` - fail-closed behavior and reason codes
- `API.md` - `/api/autonomous-trading/*` read APIs
- `VALIDATION.md` - tests and validation commands

## Default Safety

Autonomous paper entry and exit are disabled by default. Shadow mode is the safe default.

```bash
AUTONOMOUS_TRADING_ENABLED=false
AUTONOMOUS_TRADING_MODE=shadow
AUTONOMOUS_ENTRY_ENABLED=false
AUTONOMOUS_EXIT_ENABLED=false
AUTONOMOUS_SHADOW_EXECUTION_ENABLED=true
```

