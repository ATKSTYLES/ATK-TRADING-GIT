# ATK Deck V2 — Data Dictionary

## 1. Core Entities (15 Portable Entities)
1. **UserProfile**: `id`, `userId`, `email`, `displayName`, `timezone`, `currency`, `theme`, `sourceApplication`, `sourceCreatedAt`, `sourceUpdatedAt`.
2. **TradingAccount**: `id`, `userId`, `name`, `broker`, `accountType` (`personal|funded|demo|paper`), `currency`, `initialBalance`, `defaultRiskPercent`, `isActive`, `notes`.
3. **DailyJournal**: `id` (`YYYY-MM-DD` or UUID), `userId`, `date`, `timezone`, `plannedActivities`, `morningNotes`, `dailyEmotionalState`, `disciplineRating`, `checklistItems[]`, `dailyReflection`.
4. **TradingSession**: `id`, `userId`, `date`, `sessionName`, `sessionCategory` (`standard|custom`), `sessionTemplateId`, `timezone`, `plannedStart`, `plannedEnd`, `actualStart`, `actualEnd`, `attendanceStatus`, `arrivalDelayMinutes`, `earlyDepartureMinutes`, `setupAvailability`, `sittingLocation` (`Home|Office|Trading Desk|Travelling|Other`), `sittingLocationOther`, `preSessionEmotion`, `preSessionEmotionNote`, `preSessionPreparation`, `sessionBias`, `sessionEmotions[]`, `postSessionEmotions[]`, `sessionChecklist[]`, `sessionNotes`, `observations`, `steppedBackCount`, `linkedTradeCount`, `sessionSummary`, `planAdherence`, `closingReflection`, `status`.
5. **SessionEvent**: `id`, `userId`, `sessionId`, `eventType`, `label`, `notes`, `emotion`, `timestamp`, `timezone`.
6. **Trade**: `id`, `tradeGroupId`, `userId`, `date`, `timezone`, `sessionId`, `isOutOfSession`, `accountId`, `instrument`, `market`, `direction`, `status`, `bias`, `timeframe`, `entryType`, `setupLabel`, `entryTimestamp`, `entryPrice`, `stopLoss`, `takeProfit`, `positionSize`, `plannedRisk`, `riskPercent`, `expectedProfitPercent`, `actualProfitPercent`, `tpOutcome`, `slOutcome`, `exitOutcome`, `entryReason`, `expectedOutcome`, `preEntryEmotion`, `confidence`, `antiBiasPauseCompleted`, `duringTradeDurationSeconds`, `exitTimestamp`, `exitPrice`, `exitReason`, `actualOutcome`, `grossPnl`, `commission`, `otherCharges`, `netPnl`, `realisedR`, `result`, `postExitEmotions[]`, `mistakes[]`, `lessons`, `disciplineQuestions`, `attachmentIds[]`.
7. **TradeEvent**: `id`, `userId`, `tradeId`, `phase` (`before_entry|during_trade|exit`), `eventType`, `label`, `details`, `price`, `quantity`, `emotion`, `timestamp`, `timezone`.
8. **TradeGroup**: `id`, `userId`, `name`, `description`, `date`.
9. **Attachment**: `id`, `userId`, `entityType` (`trade|session|daily_journal|review`), `entityId`, `filename`, `mimeType`, `sizeBytes`, `caption`, `dataUrl`.
10. **SessionTemplate**: `id`, `userId`, `name`, `market`, `plannedStartTime`, `plannedEndTime`, `timezone`, `defaultChecklist[]`, `notes`.
11. **ChecklistDefinition**: `id`, `userId`, `name`, `scope` (`daily|session|pre_trade`), `items[]`, `isDefault`.
12. **Instrument**: `id`, `userId`, `symbol`, `name`, `market`, `tickSize`, `pointValue`, `defaultCommission`, `isActive`.
13. **UserPreferences**: `id`, `userId`, `timeframes[]`, `setupLabels[]`, `entryTypes[]`, `sessionQuickActions[]`, `antiBiasPauseSeconds`, `defaultAccountId`.
14. **Review**: `id`, `userId`, `reviewType` (`daily|weekly|monthly|strategy`), `title`, `periodStart`, `periodEnd`, `strategyName`, `summary`, `tradingMistakes`, `lessonsLearned`, `behaviouralPatterns`, `improvementGoals`, `rating`.
15. **ExportManifest & AuditLog**: Package metadata (`format`, `format_version`, `export_timestamp`, `record_counts`, `attachment_count`, `checksum_sha256`) and immutable audit logs (`export_backup`, `import_commit`, etc.).

## 2. Relationships
- `TradingSession` 1 ─── * `SessionEvent` (`sessionId`)
- `TradingSession` 1 ─── * `Trade` (`sessionId`, optional; `isOutOfSession=true` when absent)
- `Trade` 1 ─── * `TradeEvent` (`tradeId`)
- `TradingAccount` 1 ─── * `Trade` (`accountId`)
- `TradeGroup` 1 ─── * `Trade` (`tradeGroupId`)
- `Attachment` * ─── 1 `{trade|session|daily_journal|review}` (`entityType` + `entityId`)
- `DailyJournal` relates to all `TradingSession` records sharing the same `date`.
