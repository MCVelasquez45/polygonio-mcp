# V2 Strategy Analytics Source Map

Strategy Analytics consumes only persisted evidence from Version 1 and the upstream Version 2 intelligence layers. It does not query brokers, providers, or live runtime state.

| Metric / field | Source | Confidence | Fallback |
| --- | --- | --- | --- |
| `analyticsId` | Derived from `windowType + tradingDate + environment` | High | Deterministic derivation |
| `windowType`, `windowStart`, `windowEnd` | Strategy Analytics request inputs | High | Reject malformed inputs |
| `generatedAt` | Server timestamp at generation | High | Never backfill with runtime estimate |
| `environment` | `TradingSession.environment` | High | `PAPER` if sessions are absent |
| `performance.totalTrades` | Count of `TradeReport` records in window | High | `0` when no trade reports exist |
| `performance.wins/losses/breakeven` | `TradeReport.performance.realizedPnl` | High | `Not captured` when trade P/L is unavailable |
| `performance.netPnl` | Sum of `TradeReport.performance.realizedPnl` | High | `Not captured` when all trade P/L is unavailable |
| `performance.winRate`, `expectancy`, `profitFactor` | Aggregated trade P/L from `TradeReport` | High | `Not captured` when insufficient closed trades exist |
| `performance.averageWinner`, `averageLoser` | Aggregated trade P/L from `TradeReport` | High | `Not captured` when the relevant cohort is empty |
| `performance.drawdown`, `capitalEfficiency` | `DailyReport.performance` and `DailyReport.capital` | Medium | `Not captured` when daily capital evidence is missing |
| `strategyBreakdown` | `TradeReport.identity.strategy` and `DecisionJournal.context.strategy` | Medium | `Other` / `Not captured` |
| `underlyingBreakdown` | `TradeReport.identity.underlying` | High | `Not captured` |
| `sectorBreakdown` | `TradeReport.marketContext.sectorContext` | Medium | `Not captured from current provider` |
| `marketRegimeBreakdown` | `TradeReport.marketContext.marketRegime`, `DecisionJournal.evaluation.marketRegime` | High | `Not captured` |
| `confidenceBreakdown` | `TradeReport.signal.confidence`, `DecisionJournal.evaluation.confidence` | High | `Not captured` |
| `dteBreakdown` | `TradeReport.identity.contractExpiration` plus `TradeReport.lifecycle.openedAt` | High | `Not captured` |
| `deltaBreakdown` | `TradeReport.greeks.delta` | High | `Not captured` |
| `ivBreakdown` | `TradeReport.greeks.iv` | High | `Not captured` |
| `weekdayBreakdown` | `TradeReport.lifecycle.openedAt` converted to New York time | High | `Not captured` |
| `timeOfDayBreakdown` | `TradeReport.lifecycle.openedAt` converted to New York time | High | `Not captured` |
| `exitReasonBreakdown` | `TradeReport.lifecycle.exitReason` | High | `Not captured` |
| `riskProfileBreakdown` | `DecisionJournal.riskSnapshot.positionSize` | Medium | `Not captured` |
| `evidenceQuality.availableEvidencePercent` | Coverage checks across `TradingSession`, `DailyReport`, `TradeReport`, and `DecisionJournal` | Medium | `0` when no evidence exists |
| `warnings[]` | Derived from missing or inconsistent persisted evidence | High | Explicit warning codes |
| `references.sessionIds` | `TradingSession.sessionId` | High | Empty array |
| `references.dailyReportIds` | `DailyReport.reportId` | High | Empty array |
| `references.tradeReportIds` | `TradeReport.reportId` | High | Empty array |
| `references.decisionJournalIds` | `DecisionJournal.decisionId` | High | Empty array |

## Evidence Window

- Daily analytics aggregate one trading date.
- Weekly analytics aggregate the Monday-to-Sunday window containing the requested trading date.
- Monthly analytics aggregate the calendar month containing the requested trading date.
- Rolling analytics aggregate the trailing 30 calendar days ending on the requested trading date.

## Missing Data Policy

If a field cannot be traced to persisted evidence, Strategy Analytics must show an honest absence state instead of inventing a value.

Preferred absence language:

- `Not captured`
- `Unavailable from current provider`
- `Unavailable from captured evidence`

Do not replace missing evidence with zeroes unless the source model explicitly stores a zero.
