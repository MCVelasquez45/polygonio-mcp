# Shadow Mode

Shadow mode mirrors execution intent without submitting to Alpaca.

The shadow adapter records:

- intended entry price
- contract
- intended quantity
- stop and target
- bid, ask, and mid
- configured slippage
- timestamps
- simulated fill status
- hypothetical P/L fields

Records are labeled:

```text
SHADOW_SIMULATION
```

Shadow results must never be combined with paper results unless grouped by `executionSource`.

## Example

```json
{
  "source": "SHADOW_SIMULATION",
  "symbol": "OXY",
  "optionContract": "O:OXY260724C00060000",
  "quantity": 1,
  "mid": 1.1,
  "slippagePct": 0.02,
  "simulatedFillPrice": 1.12,
  "status": "SIMULATED_FILLED"
}
```

