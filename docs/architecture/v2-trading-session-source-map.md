# V2 Trading Session Source Map

Date: July 17, 2026
Milestone: Trading Session Capture

Trading Session Capture uses persisted Version 1 evidence first. Runtime counters are used only for same-process provider/health summaries and are explicitly marked unavailable when V1 does not persist the field.

| Trading session field | Existing source | Persistence type | Required or optional | Fallback behavior |
| --- | --- | --- | --- | --- |
| `sessionId` | Deterministic V2 key from environment, trading date, automation session id | New `intelligence_trading_sessions` field | Required | `paper:YYYY-MM-DD:aggregate` when no automation session is found |
| `tradingDate` | `AutomationSession.lastResetTradingDate` or exchange date derived with `exchangeTradingDate()` | Existing automation session / computed | Required | Request date or current exchange date |
| `timezone` | V2 constant `America/New_York` | New session field | Required | No fallback |
| `status` | V2 lifecycle state | New session field | Required | `INITIALIZING` until market evidence is captured |
| `environment` | `AutomationSession.mode` | Existing automation session | Required | `PAPER` when mode is absent because V1 baseline is paper trading |
| `marketStatus` | `UniverseEvaluation.marketClockDecision.state` | Existing persisted evaluation | Required | `UNAVAILABLE` plus `MARKET_STATUS_UNAVAILABLE` warning |
| `startedAt` | `AutomationSession.startedAt`, then `createdAt`, then exchange-window start | Existing automation session / computed | Required | Exchange-window start |
| `marketOpenedAt` | Not persisted in V1 | Not captured | Optional | `null` |
| `marketClosedAt` | Not persisted in V1 | Not captured | Optional | `null` |
| `finalizationStartedAt` | V2 finalization service | New session field | Optional | `null` until finalization starts |
| `finalizedAt` | V2 finalization service | New session field | Optional | `null` until finalized |
| `automationSessionId` | `AutomationSession._id` | Existing automation session | Optional | `null` for aggregate/no-session records |
| `watchlist.symbols` | `UniverseEvaluation.configuredSymbols`; current `WatchlistItem` only as fallback | Persisted evaluation / current watchlist | Required | Empty array plus `WATCHLIST_NOT_CAPTURED` warning |
| `watchlist.size` | Count of `watchlist.symbols` | Derived summary | Required | `0` with warning if unavailable |
| `evaluationSummary.windowsEvaluated` | `UniverseEvaluation` count | Existing persisted evaluations | Required | `0` plus `NO_EVALUATION_EVIDENCE` warning |
| `evaluationSummary.symbolsEvaluated` | `UniverseEvaluation.symbolResults` | Existing persisted evaluations | Required | Distinct `TradeCandidate.underlying` count |
| `evaluationSummary.signalsGenerated` | `TradeCandidate.status` in signal/approved/rejected states | Existing persisted candidates | Required | `0` when no candidates exist |
| `evaluationSummary.noSignalCount` | `TradeCandidate.status = NO_TRADE` | Existing persisted candidates | Required | `0` |
| `evaluationSummary.dataRejectCount` | `TradeCandidate.status = DATA_REJECTED` | Existing persisted candidates | Required | `0` |
| `evaluationSummary.riskRejectCount` | `RiskDecision.approved = false`, `TradeCandidate.status = RISK_REJECTED`, `UniverseEvaluation.outcome = RISK_REJECTED` | Existing persisted risk/evaluation records | Required | Max available count, otherwise `0` |
| `evaluationSummary.approvedCount` | `RiskDecision.approved = true` | Existing persisted risk decisions | Required | `0` |
| `tradeSummary.tradesOpened` | `AutomationPosition.openedAt` / session position records | Existing persisted positions | Required | `0` |
| `tradeSummary.tradesClosed` | `AutomationPosition.status = CLOSED` | Existing persisted positions | Required | `0` |
| `tradeSummary.winningTrades` | `AutomationPosition.realizedPnl > 0` | Existing persisted positions | Required | `0` |
| `tradeSummary.losingTrades` | `AutomationPosition.realizedPnl < 0` | Existing persisted positions | Required | `0` |
| `tradeSummary.breakevenTrades` | `AutomationPosition.realizedPnl = 0` | Existing persisted positions | Required | `0` |
| `tradeSummary.realizedPnl` | Sum of `AutomationPosition.realizedPnl` for closed positions | Existing persisted positions | Required | Sum known values and warn on missing closed-position P/L |
| `tradeSummary.unrealizedPnlAtClose` | Open/exit position `AutomationPosition.unrealizedPnl` | Existing persisted positions | Optional | `null` plus warning when live values are incomplete |
| `tradeSummary.totalPnl` | Realized plus known unrealized P/L | Derived summary | Optional | Realized only when no live unrealized P/L exists |
| `orderSummary.intentsCreated` | `OrderIntent` count | Existing persisted intents | Required | `0` |
| `orderSummary.ordersSubmitted` | `BrokerOrder` count | Existing persisted broker orders | Required | `0` |
| `orderSummary.fills` | `BrokerOrder.status = FILLED` or full filled quantity | Existing persisted broker orders | Required | `0` |
| `orderSummary.partialFills` | `BrokerOrder.status = PARTIALLY_FILLED` or partial filled quantity | Existing persisted broker orders | Required | `0` |
| `orderSummary.cancellations` | `BrokerOrder.status in CANCELLED/CANCEL_PENDING` | Existing persisted broker orders | Required | `0` |
| `orderSummary.rejections` | `BrokerOrder.status = REJECTED` plus failed/rejected intents without broker order | Existing persisted broker orders/intents | Required | `0` |
| `orderSummary.manualReviewCount` | `AutomationPosition`, `OrderIntent`, `BrokerOrder` manual-review states | Existing persisted records | Required | `0` |
| `portfolioSnapshot` | No durable V1 daily account snapshot | Not captured | Optional | `null` plus `PORTFOLIO_SNAPSHOT_NOT_CAPTURED` warning |
| `providerSummary.totalRequests` | `getMassiveRequestStats().requestsByPriority` | Runtime counter | Required | `0` when process has no counter history |
| `providerSummary.cacheHits` | `getMassiveRequestStats().cacheHits` | Runtime counter | Required | `0` |
| `providerSummary.cacheHitRate` | `getMassiveRequestStats().cacheHitRate` | Runtime counter | Optional | `null` when no cache reads occurred |
| `providerSummary.rateLimitCount` | `getMassiveRequestStats().rateLimitResponses` | Runtime counter | Required | `0` |
| `providerSummary.providerErrors` | Not persisted in V1 provider stats | Not captured | Optional | `null` plus `PROVIDER_ERROR_COUNT_NOT_PERSISTED` warning |
| `providerSummary.entitlementRejects` | `getEntitlementBlocks()` active block count | Runtime entitlement registry | Required | `0` |
| `automationHealth.schedulerHealthy` | `getSchedulerStatus()` | Runtime controller state | Optional | `null` when unavailable |
| `automationHealth.monitorHealthy` | `getMonitorStatus()` | Runtime controller state | Optional | `null` when unavailable |
| `automationHealth.reconciliationClean` | `AutomationSession.reconciliationStatus`, reconciliation event, or last runtime reconciliation | Persisted session/event plus runtime fallback | Optional | `false/null`, finalization gate blocks unless true |
| `automationHealth.brokerConnected` | `isBrokerTruthCurrent()` | Runtime broker reconciliation freshness | Optional | `null/false`; no broker call is made |
| `automationHealth.marketDataConnected` | `getMassiveRequestStats().state` | Runtime provider state | Optional | `false` when state is not OK |
| `automationHealth.mongoConnected` | `mongoose.connection.readyState` | Runtime DB state | Optional | `false` when disconnected |
| `automationHealth.emergencyStopActivated` | `AutomationSession.emergencyStop` or emergency-stop automation event | Persisted session/event | Required | `false` |
| `references.candidateIds` | `TradeCandidate._id` | Existing persisted candidates | Required | Empty array |
| `references.riskDecisionIds` | `RiskDecision._id` | Existing persisted risk decisions | Required | Empty array |
| `references.orderIntentIds` | `OrderIntent._id` | Existing persisted intents | Required | Empty array |
| `references.brokerOrderIds` | `BrokerOrder._id` | Existing persisted broker orders | Required | Empty array |
| `references.positionIds` | `AutomationPosition._id` | Existing persisted positions | Required | Empty array |
| `references.eventIds` | `AutomationEvent._id` | Existing persisted events | Required | Empty array |
| `references.closedTradeIds` | Closed `AutomationPosition._id` | Existing persisted positions | Required | Empty array |
| `warnings` | Warning automation events plus capture warnings | Persisted events / V2 capture | Required | Empty array |
| `errors` | Critical automation events plus capture errors | Persisted events / V2 capture | Required | Empty array |
| `generation.*` | V2 capture service | New session metadata | Required | No fallback |
