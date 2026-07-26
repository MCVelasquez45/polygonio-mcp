# Failure Handling

Every autonomous paper entry gate fails closed. A blocked entry is persisted and shown in the UI with a plain-language reason.

## Entry Gate Conditions

- `AUTONOMOUS_TRADING_ENABLED=true`
- `AUTONOMOUS_ENTRY_ENABLED=true`
- mode is `AUTONOMOUS_PAPER`
- Alpaca environment is paper
- market is open
- automation is ready
- MongoDB is connected
- broker truth is current
- execution lease is owned
- Emergency Stop is inactive
- Risk approval exists
- Risk approval is approved
- Risk approval is not expired
- recommendation package matches approval package
- lifecycle does not already exist
- no duplicate order intent exists
- position and order limits permit entry

## Common Failure States

| State | Reason Code | Operator Message |
| --- | --- | --- |
| Market closed | `MARKET_NOT_OPEN` | The market is not open for entries. |
| Broker truth stale | `BROKER_TRUTH_STALE` | Broker truth is stale or unavailable. |
| Lease not owned | `EXECUTION_LEASE_NOT_OWNED` | This process does not own the execution lease. |
| Emergency stop | `EMERGENCY_STOP_ACTIVE` | Emergency Stop is active. |
| Risk expired | `RISK_APPROVAL_EXPIRED` | The approval package is expired. |
| Duplicate order | `DUPLICATE_ORDER_INTENT` | A duplicate order intent already exists. |

Safe retry is allowed after the blocking condition is corrected.

