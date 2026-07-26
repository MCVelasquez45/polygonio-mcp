# Operating Modes

## Manual

The operator selects and submits trades manually. Manual orders continue through the existing manual Execution Gateway path. Autonomous services may show information but do not initiate orders or claim manual trades.

## Shadow

The complete pipeline runs without broker order submission.

Operator banner:

```text
SHADOW MODE - No broker orders will be submitted.
```

Shadow results use:

```text
SHADOW_SIMULATION
```

## Autonomous Paper

Approved autonomous entries and exits may submit Alpaca Paper orders only after all gates pass.

Operator banner:

```text
AUTONOMOUS PAPER MODE - Paper orders may be submitted.
```

Required flags:

```bash
AUTONOMOUS_TRADING_ENABLED=true
AUTONOMOUS_TRADING_MODE=paper
AUTONOMOUS_ENTRY_ENABLED=true
```

For exits:

```bash
AUTONOMOUS_EXIT_ENABLED=true
```

Live-money execution is not supported.

