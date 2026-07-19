# V2 Trade Report Source Map

Milestone: Version 2, Milestone 2, Trade Intelligence Reports

Trade reports are generated only from persisted Version 1 automation evidence and Version 2 finalized trading sessions. The generator does not call Alpaca, Massive/Polygon, or any live provider.

| Field | Source | Persistence | Confidence | Fallback |
| ----- | ------ | ----------- | ---------- | -------- |
| `reportId` | Deterministic `trade:${AutomationPosition._id}` | V2 `intelligence_trade_reports` | High | Generation fails if position missing |
| `tradeId` | `AutomationPosition._id` | V1 Mongo `automation_positions` | High | Generation fails if position missing |
| `sessionId` | `TradingSession.sessionId` by closed-trade reference or automation session | V2 Mongo `intelligence_trading_sessions` | High | Generation fails until session exists |
| `automationSessionId` | `AutomationPosition.automationSessionId` | V1 Mongo | High | Generation fails if absent |
| `environment` | `TradingSession.environment` | V2 Mongo | High | Defaults to `PAPER` only if session evidence omits it |
| `tradingDate` | `TradingSession.tradingDate` | V2 Mongo | High | Derived from position timestamp only if session date missing |
| Underlying | `AutomationPosition.underlying` | V1 Mongo | High | Generation fails if position invalid |
| Contract symbol | `AutomationPosition.optionSymbol` | V1 Mongo | High | Generation fails if position invalid |
| Direction | `AutomationPosition.direction` | V1 Mongo | High | Generation fails if position invalid |
| Strategy | `AutomationPosition.strategyVersionId` | V1 Mongo | Medium | Stored as strategy version, not descriptive strategy name |
| Contract type/strike/expiration | `ContractSelection.selected` or matching candidate | V1 Mongo `automation_contract_selections` | High when present | `null` plus warning |
| Entry timestamp | `AutomationPosition.openedAt` | V1 Mongo | High | `null`; UI shows `Not captured` |
| Exit timestamp | `AutomationPosition.closedAt` | V1 Mongo | High | `null`; UI shows `Not captured` |
| Hold time | Computed from `openedAt` and `closedAt` | Deterministic derived | High when both timestamps exist | `null` |
| Exit reason | `AutomationPosition.exitReason` | V1 Mongo | High | `null`; UI shows `Exit reason not captured` |
| Entry order | `BrokerOrder` matched by entry broker/client order ID | V1 Mongo `automation_broker_orders` | High when present | `null` plus warning |
| Exit order | `BrokerOrder` matched by exit broker order ID | V1 Mongo | High when present | `null` plus warning |
| Entry intent | `OrderIntent` matched by entry intent/client/broker ID | V1 Mongo `automation_order_intents` | High when present | `null` |
| Exit intent | `OrderIntent` matched by exit intent/broker ID | V1 Mongo | High when present | `null` |
| Fill count | Broker order statuses and filled quantities | V1 Mongo | High | `0` means no persisted fills found |
| Partial/cancel/reject counts | Broker order and intent statuses | V1 Mongo | High | `0` means no matching persisted state |
| Retry count | `AutomationPosition.exitAttemptCount` and intent attempts | V1 Mongo | High | `0` |
| Entry/exit slippage | Limit price from intent/order versus position average fill | V1 Mongo + deterministic calculation | Medium | `null` if limit/fill unavailable |
| Fill quality | Deterministic interpretation of slippage/fill/reject evidence | Derived | Medium | `Unavailable from captured evidence` |
| Market status | `TradingSession.marketStatus` and universe market-clock evidence | V2/V1 Mongo | Medium | `null` plus warning |
| Underlying at selection | `ContractSelection.underlyingPrice` | V1 Mongo | High when present | `null` |
| Liquidity | `ContractSelection.selected` bid/ask/mid/spread/OI/volume | V1 Mongo | High when present | `null` |
| SPY context | No V1 persisted source | Not captured | Unavailable | `null` plus warning |
| Sector context | No V1 persisted source | Not captured | Unavailable | `null` plus warning |
| VIX context | No V1 persisted source | Not captured | Unavailable | `null` plus warning |
| Trend/regime | `TradeCandidate.conditions` when present | V1 Mongo mixed field | Low to medium | `null` |
| Delta | `ContractSelection.selected.delta` | V1 Mongo | High when present | `null` plus warning |
| IV | `ContractSelection.selected.iv` | V1 Mongo | High when present | `null` plus warning |
| Theta/gamma/vega | No V1 persisted source in contract selection | Not captured | Unavailable | `null` plus warning |
| Confidence/flow/momentum/trend score | `TradeCandidate.conditions` when captured | V1 Mongo mixed field | Medium | `null` |
| Risk score | Pass ratio from `RiskDecision.checks` | V1 Mongo + deterministic calculation | Medium | `null` |
| Candidate rank | `UniverseEvaluation.ranking` | V1 Mongo | High when present | `null` |
| Candidate status | `TradeCandidate.status` | V1 Mongo | High | `null` |
| Risk approved/reasons | `RiskDecision.approved` and `reasonCodes` | V1 Mongo | High when present | `null` or empty array |
| Selected contract score | `ContractSelection.selected.score` or universe ranking contract score | V1 Mongo | High when present | `null` |
| Entry price | `AutomationPosition.avgEntryPrice` | V1 Mongo | High | `null` |
| Exit price | `AutomationPosition.avgExitPrice` | V1 Mongo | High | `null` |
| Contracts | `AutomationPosition.filledQty` | V1 Mongo | High | `0` means no persisted filled quantity |
| Realized P/L | `AutomationPosition.realizedPnl` | V1 Mongo | High | `null` |
| Return % | `AutomationPosition.returnPct` | V1 Mongo | High when captured | `null` |
| MFE/MAE | `AutomationPosition.maxFavorableExcursion`, `maxAdverseExcursion` | V1 Mongo | Medium | `null` |
| Fees | `AutomationPosition.entryFees`, `exitFees` | V1 Mongo | Medium | `null` when not captured |
| Entry grade | Deterministic grade from candidate, risk, selection, ranking | Derived | Medium | `UNAVAILABLE` if component evidence absent |
| Exit grade | Deterministic grade from exit reason, P/L, close timestamp | Derived | Medium | `UNAVAILABLE` if component evidence absent |
| Risk grade | Deterministic grade from risk decision, MAE, overnight recovery | Derived | Medium | `UNAVAILABLE` if component evidence absent |
| Execution grade | Deterministic grade from fills, retries, slippage, rejects | Derived | Medium | `UNAVAILABLE` if component evidence absent |
| Market grade | Deterministic grade from market status and liquidity evidence | Derived | Medium | `UNAVAILABLE` if component evidence absent |
| Overall grade | Average of available component scores | Derived | Medium | `UNAVAILABLE` if no component grades |
| Lessons | Deterministic statements from P/L, risk, execution, recovery, missing evidence | Derived | Medium | Empty arrays if nothing can be derived |
| Timeline | Candidate, selection, risk, intents, broker orders, position, automation events | V1 Mongo + deterministic ordering | High when source events exist | Empty array |
| Evidence references | IDs from position, orders, intents, risk, candidate, selection, evaluations, events | V1/V2 Mongo | High | Empty arrays or `null` |
| Warnings | Missing or incomplete evidence detected during generation | V2 report | High | Empty array |
| Generation metadata | Generator constants and source window | V2 report | High | Source window nullable |
