# V2 Decision Journal Source Map

Milestone: Version 2, Milestone 4

The Decision Journal captures deterministic decision evidence from persisted automation records. It does not call brokers, query providers, ask GPT, or change trading behavior.

| Decision source | Persisted source | Available metadata | Confidence | Fallback |
| --- | --- | --- | --- | --- |
| Watchlist/universe evaluation | `UniverseEvaluationModel` / `automation_universe_evaluations` | Configured symbols, symbol results, eligibility, ranking, selected symbol, selected contract, risk outcome, order intent ID, market clock, reason codes | High | Missing ranking or market clock is recorded as missing evidence. |
| Candidate generation | `TradeCandidateModel` / `automation_trade_candidates` | Underlying, strategy, bar timestamp, signal direction, status, reason codes, indicator snapshot, market clock, market data health, conditions | High | Missing condition scores are recorded as missing fields. |
| No-signal decision | `TradeCandidate.status = NO_TRADE` | Reason codes, indicator snapshot, conditions, market clock | High | Uses `NO_SIGNAL` reason when no reason code exists. |
| Data rejection | `TradeCandidate.status = DATA_REJECTED` or `CLOCK_REJECTED` | Data health, market clock, reason codes | High | Missing health details are recorded as missing fields. |
| Contract selection | `ContractSelectionModel` / `automation_contract_selections` | Considered contracts, passed contracts, selected contract, rejected alternatives, score, liquidity, spread, IV, delta | High | No selected contract becomes `BUY_REJECTED` with no-selection reason. |
| Risk approval/rejection | `RiskDecisionModel` / `automation_risk_decisions` | Approved flag, reason codes, checks, sizing inputs/outputs, decided timestamp | High | Missing sizing outputs are recorded as missing fields. |
| Order approval intent | `OrderIntentModel` / `automation_order_intents` | Intent type, direction, quantity, limit price, status, idempotency inputs, broker order ID | High | Broker order ID remains null if no broker acknowledgement exists. |
| Exit intent | `OrderIntentModel` plus linked `AutomationPosition` | EXIT intent, direction, limit, status, exit reason when linked to a position | Medium | If no position link exists, the intent is still captured without trade ID. |
| Position exit decision | `AutomationPositionModel` / `automation_positions` | Exit reason, exit policy, exit intent ID, exit broker order ID, overnight recovery fields, close timestamp | Medium | If exit policy is unavailable, missing evidence is recorded. |
| Emergency-stop event | `AutomationEventModel` / `automation_events` | Event name, service, severity, timestamp, payload, symbol, intent, broker order | Medium | Captured only when an emergency-stop event exists. |
| Order timeout/cancel event | `AutomationEventModel` | Event name, service, severity, payload | Medium | Captured only when timeout/cancel events are persisted. |
| Trade linkage | `AutomationPositionModel` and `TradeReportModel` | Position ID, trade report ID, order intent IDs | Medium | Journal entry remains valid with null `tradeId` or `reportId`. |
| Session linkage | `TradingSessionModel` / `intelligence_trading_sessions` | Session ID, automation session ID, environment, source evidence window | High | Backfill fails if no Trading Session exists for the date. |

## Decision Type Mapping

| Journal decision type | Source rule |
| --- | --- |
| `BUY_APPROVED` | Risk approved, entry intent created, selected universe opportunity, approved candidate, or selected contract. |
| `BUY_REJECTED` | Entry order intent failed, broker rejected, or contract selection produced no selected contract. |
| `SELL_APPROVED` | EXIT order intent created or submitted. |
| `SELL_REJECTED` | EXIT order intent failed, broker rejected, or manual review state. |
| `SIGNAL_REJECTED` | Candidate ranked but not selected. |
| `NO_SIGNAL` | Candidate status `NO_TRADE`. |
| `DATA_REJECTED` | Candidate or universe gate rejected because market/data evidence was unavailable or invalid. |
| `RISK_REJECTED` | Risk decision rejected or universe outcome is risk rejected. |
| `ORDER_CANCELLED` | Persisted cancel event. |
| `ORDER_TIMEOUT` | Persisted timeout event. |
| `EXIT_TRIGGERED` | Position exit evidence or exit-trigger event exists. |
| `EMERGENCY_STOP` | Persisted emergency-stop event. |
| `NO_ACTION` | Duplicate, no eligible symbols, no selected universe action, or informational decision. |

## Known Missing Evidence

The current journal records these as unavailable when they are not persisted upstream:

- Theta, gamma, and vega for many contract-selection snapshots.
- Estimated reward and reward/risk unless emitted by risk sizing.
- Broker order ID before broker acknowledgement.
- Trade report ID until a Trade Report exists.
- Emergency-stop decisions unless an automation event was persisted.
