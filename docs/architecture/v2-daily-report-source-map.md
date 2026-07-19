# V2 Daily Report Source Map

Milestone: Version 2, Milestone 3

Daily Reports aggregate only persisted `TradingSession` and `TradeReport` records. They do not read raw Version 1 trade records directly, call brokers, query providers, rebuild market state, or change execution behavior.

| Daily field | Source | Confidence | Fallback |
| --- | --- | --- | --- |
| `reportId` | Deterministic `daily:${TradingSession.sessionId}` | High | Generation fails if session is missing. |
| `sessionId` | `TradingSession.sessionId` | High | Generation fails if session is missing. |
| `tradingDate` | `TradingSession.tradingDate` | High | Generation fails if session is missing. |
| `environment` | `TradingSession.environment` | High | Generation fails if session is missing. |
| `status` | Daily generator output | High | Existing report is returned idempotently. |
| `executiveSummary.overallGrade` | Daily deterministic overall grade | Medium | `UNAVAILABLE` if component grades are unavailable. |
| `executiveSummary.marketSummary` | `TradingSession.marketStatus` | Medium | States that market status was not captured. |
| `executiveSummary.sessionSummary` | Generated `TradeReport` count, win/loss count, net P/L | High when trade reports exist | Uses unavailable wording for missing net P/L. |
| `executiveSummary.primaryLesson` | Trade report outcomes and exit reasons | Medium | Null when no deterministic lesson can be derived. |
| `executiveSummary.bestDecision` | Largest winning `TradeReport.performance.realizedPnl` | High when realized P/L exists | States no profitable trade was captured. |
| `executiveSummary.worstDecision` | Largest losing `TradeReport.performance.realizedPnl` | High when realized P/L exists | States no losing trade was captured. |
| `executiveSummary.highlights` | Daily grade, net P/L, largest winner, largest loser | Medium | Uses explicit no-winner/no-loser wording. |
| `executiveSummary.keyFindings` | Session summary, market summary, warning count | Medium | Warning count states no warnings when none exist. |
| `tradingSummary.watchlistSize` | `TradingSession.watchlist.size` | High | `0` when no watchlist evidence exists. |
| `tradingSummary.symbolsEvaluated` | `TradingSession.evaluationSummary.symbolsEvaluated` | High | `0` when not captured. |
| `tradingSummary.signalsGenerated` | `TradingSession.evaluationSummary.signalsGenerated` | High | `0` when not captured. |
| `tradingSummary.signalsApproved` | `TradingSession.evaluationSummary.approvedCount` | High | `0` when not captured. |
| `tradingSummary.signalsRejected` | `riskRejectCount + dataRejectCount` from `TradingSession.evaluationSummary` | Medium | `0` when not captured. |
| `tradingSummary.riskRejects` | `TradingSession.evaluationSummary.riskRejectCount` | High | `0` when not captured. |
| `tradingSummary.dataRejects` | `TradingSession.evaluationSummary.dataRejectCount` | High | `0` when not captured. |
| `tradingSummary.tradesOpened` | `TradingSession.tradeSummary.tradesOpened` | High | `0` when not captured. |
| `tradingSummary.tradesClosed` | `TradingSession.tradeSummary.tradesClosed` | High | `0` when not captured. |
| `tradingSummary.wins` | Positive `TradeReport.performance.realizedPnl`, then `TradingSession.tradeSummary.winningTrades` | High when trade reports exist | Session summary fallback. |
| `tradingSummary.losses` | Negative `TradeReport.performance.realizedPnl`, then `TradingSession.tradeSummary.losingTrades` | High when trade reports exist | Session summary fallback. |
| `tradingSummary.breakeven` | Zero `TradeReport.performance.realizedPnl`, then `TradingSession.tradeSummary.breakevenTrades` | High when trade reports exist | Session summary fallback. |
| `performance.realizedPnl` | Sum of `TradeReport.performance.realizedPnl`, then `TradingSession.tradeSummary.realizedPnl` | High when trade reports exist | Null when unavailable. |
| `performance.unrealizedPnl` | `TradingSession.tradeSummary.unrealizedPnlAtClose` | Medium | Null when unavailable. |
| `performance.netPnl` | `TradingSession.tradeSummary.totalPnl`, then realized plus unrealized P/L | High when session total exists | Null when unavailable. |
| `performance.averageWinner` | Average positive `TradeReport.performance.realizedPnl` | High when trade reports exist | Null when no winners or no P/L evidence. |
| `performance.averageLoser` | Average negative `TradeReport.performance.realizedPnl` | High when trade reports exist | Null when no losers or no P/L evidence. |
| `performance.largestWinner` | Max positive `TradeReport.performance.realizedPnl` | High when trade reports exist | Null when no winning trade exists. |
| `performance.largestLoser` | Min negative `TradeReport.performance.realizedPnl` | High when trade reports exist | Null when no losing trade exists. |
| `performance.averageHoldTimeMinutes` | Average `TradeReport.lifecycle.holdTimeMinutes` | High when captured | Null when unavailable. |
| `performance.profitFactor` | Gross profit divided by absolute gross loss from trade reports | Medium | Null when denominator is unavailable or zero. |
| `performance.expectancy` | Average realized P/L from trade reports | High when trade reports exist | Null when unavailable. |
| `capital.equity` | `TradingSession.portfolioSnapshot.equity` | Medium | Null and warning when snapshot is missing. |
| `capital.cash` | `TradingSession.portfolioSnapshot.cash` | Medium | Null and warning when snapshot is missing. |
| `capital.buyingPower` | `TradingSession.portfolioSnapshot.buyingPower` | Medium | Null and warning when snapshot is missing. |
| `capital.drawdown` | Minimum `TradeReport.performance.drawdown` or `maxAdverseExcursion` | Medium | Null when unavailable. |
| `capital.capitalEfficiency` | Net P/L divided by `TradingSession.portfolioSnapshot.buyingPower` | Medium | Null when buying power or net P/L is unavailable. |
| `execution.ordersSubmitted` | `TradingSession.orderSummary.ordersSubmitted` | High | `0` when not captured. |
| `execution.fills` | `TradingSession.orderSummary.fills` | High | `0` when not captured. |
| `execution.partialFills` | `TradingSession.orderSummary.partialFills` | High | `0` when not captured. |
| `execution.cancelled` | `TradingSession.orderSummary.cancellations` | High | `0` when not captured. |
| `execution.rejected` | `TradingSession.orderSummary.rejections` | High | `0` when not captured. |
| `execution.timeouts` | Not yet exposed by `TradingSession` or `TradeReport` | Low | Null and UI shows not captured. |
| `execution.retryCount` | Sum of `TradeReport.execution.retryCount` | Medium | `0` when not captured. |
| `execution.fillRate` | `fills / ordersSubmitted` from `TradingSession.orderSummary` | High when orders exist | Null when no order count exists. |
| `market.marketStatus` | `TradingSession.marketStatus` | High | Null if value is `UNAVAILABLE` or missing. |
| `market.marketRegime` | First captured `TradeReport.marketContext.marketRegime` | Medium | Null when not captured. |
| `market.spyTrend` | Not persisted in current upstream intelligence records | Low | Null and UI shows not captured. |
| `market.vix` | Not persisted in current upstream intelligence records | Low | Null and UI shows not captured. |
| `market.sectorLeadership` | Not persisted in current upstream intelligence records | Low | Null and UI shows not captured. |
| `grades.execution` | Deterministic rule using session order summary and trade retry evidence | Medium | `UNAVAILABLE` only if required inputs are absent. |
| `grades.risk` | Deterministic rule using trade risk approval and overnight recovery evidence | Medium | `UNAVAILABLE` if no trade reports exist. |
| `grades.market` | Deterministic rule using session market status and trade market grades | Medium | Missing inputs recorded in grade. |
| `grades.tradeQuality` | Average of `TradeReport.grades.overall` | Medium | `UNAVAILABLE` if trade grades are missing. |
| `grades.performance` | Net P/L, win rate, and profit factor | Medium | `UNAVAILABLE` if net P/L is unavailable. |
| `grades.evidence` | Evidence availability score | Medium | Missing inputs listed. |
| `grades.overall` | Average of deterministic component grade scores | Medium | `UNAVAILABLE` if all components are unavailable. |
| `evidenceQuality.expectedClosedTrades` | `TradingSession.tradeSummary.tradesClosed` | High | `0` when not captured. |
| `evidenceQuality.generatedTradeReports` | Count of linked `TradeReport` documents | High | `0` when none exist. |
| `evidenceQuality.missingEvidence` | Daily generator completeness checks and trade warnings | Medium | Empty array when no missing evidence is detected. |
| `evidenceQuality.warnings` | Daily generator warnings and propagated `TradeReport.warnings` | Medium | Empty array when none exist. |
| `tradeReports` | Linked `TradeReport` identity, P/L, grade, and exit reason | High | Empty array when no reports exist. |
| `tradeReportIds` | Linked `TradeReport.reportId` values | High | Empty array when no reports exist. |
| `sessionReference` | `TradingSession.sessionId`, `tradingDate`, `status` | High | Generation fails if session is missing. |
| `timeline` | Session start/finalized timestamps plus trade open/close timestamps | Medium | Empty array when timestamps are missing. |
| `warnings` | Evidence quality warnings | Medium | Empty array when none exist. |
| `generation` | Daily generator metadata | High | Created by service only. |

## Explicit Unavailable Evidence

The current Daily Report intentionally records these as unavailable when upstream intelligence records do not expose them:

- SPY trend.
- VIX.
- Sector leadership.
- Timeout count.
- Portfolio snapshot fields when `TradingSession.portfolioSnapshot` is missing.
- Any closed trade that does not yet have a generated Trade Report.

Unavailable values remain null in Mongo and are rendered as explanatory UI text instead of fake zeroes.
