# ATK Deck — Changelog

## [2.2.1] - 2026-11-18
### Fixed & Added
- **Atomic Trade Closure & Firestore Rules Hardening (`firestore.rules`, `src/storage/repository.ts`, `src/pages/DailyJournalPage.tsx`)**:
  - Replaced non-atomic two-step close writes with `commitAtomicTradeClose` (`writeBatch` updating `/users/{userId}/trades/{tradeId}` and appending a deterministic `te_close_{operationId}` event in `/users/{userId}/trade_events`).
  - Added double-submit guards (`closingTradeBusy`), frozen timestamps/durations across retries, idempotency verification when already closed by the same `operationId`, and explicit `Exit Reason *` validation while keeping monetary P&L and entry/exit prices optional.
  - Updated `firestore.rules` so verified owners (`isOwner(userId)`) can cleanly update closed trades and optional nullable fields without spurious permission rejections.
- **Global Error Diagnostics & Safe-Save System (`src/domain/diagnostics.ts`, `src/components/ErrorDiagnosticCard.tsx`, `src/context/WorkspaceContext.tsx`, `src/pages/SettingsExportPage.tsx`)**:
  - Implemented 8-category structured error classification (`validation`, `authentication`, `permission`, `database`, `network`, `synchronisation`, `conflict`, `application`) with correlation IDs, sanitized technical logs (redacting emails, tokens, API keys, passwords, and private journal/monetary fields), verified local/cloud status badges, one-click retry, copyable reports, pending local sync queue recovery, and an **Error History & Diagnostics** view inside `Settings & Export`.
  - Wrapped async handlers across Auth, Daily Journal, Sessions, Trades, Reviews, Attachments, Settings, Exports, and UTDS Imports with safe error reporting and form state preservation.

## [2.2.0] - 2026-11-18
### Changed
- **Separated Daily Journal & Daily / Session Records**: Restored `Daily Journal` (`src/pages/DailyJournalPage.tsx`) as the live input workspace (Daily Preparation + upper Session Logger + lower Live Trade Logger + manual `SESSION LOGGER` | `TRADE LOGGER` toggle) and `Daily / Session Records` (`src/pages/DailySessionRecordsPage.tsx`) as the dedicated historical daily and session viewer with full Session Detail & linked Trade drawers.
- **Expanded Independent Trades Ledger**: Added lifecycle status filtering (`closed`, `during_trade`, `before_entry`), explicit linked `sessionId` / `Out-of-Session` visibility, Risk % / Profit % table columns, and full psychology, execution, discipline, mistakes/lessons, attachment, and `trade_events` timeline display in `src/pages/TradesPage.tsx`.
- **Preserved 8-Item Navigation & Data Separation**: Sidebar order is now `Dashboard`, `Daily Journal`, `Daily / Session Records`, `Trades`, `Calendar`, `Analytics`, `Reviews`, and `Settings & Export`, keeping `daily_journals`, `sessions`, `trades`, `session_events`, and `trade_events` strictly independent.

## [2.1.0] - 2026-11-18
### Changed
- **IST Session Windows & Pre-Session Check-In**: Default workspace timezone set to `Asia/Kolkata` with non-overlapping half-open standard windows (`Asian 05:30–11:30`, `London 11:30–17:30`, `New York 17:30–22:30`), `Custom` sessions, sitting location capture, and pre-session emotional check-in.
- **Behavioural & Percentage-First Live Trade Logger**: Removed mandatory entry/SL/TP price entry from the live trade form; added optional `expectedProfitPercent`, `actualProfitPercent`, `tpOutcome`, `slOutcome`, and `exitOutcome`, keeping missing monetary P&L strictly distinct from `0`.

## [2.0.0] - 2026-11-17
### Added
- **Four-Layer Architecture**: Strict separation of UI (`src/pages`, `src/components`), Application Logic (`src/domain`), Persistent Storage (`src/storage`, `firestore.rules`), and Universal Data Portability (`src/domain/utds.ts`).
- **Complete Trading Features**: Dashboard, Daily Journal (persistent daily checklist), Independent Sessions, Trades Ledger & Inspector, Two-Panel Live Engagement (Session Logger + Trade Logger with Anti-Bias Pause & strict event separation), Monday–Sunday Calendar, 4-tab Analytics with explicit sample sizes, Structured Reviews, and Settings & Export.
- **ATK-UTDS v1.0.0**: Full ZIP backup (`ATK_Trading_Backup.zip` with `manifest.json`, SHA-256 checksum, binary `attachments/`), JSON, CSV, and genuine `.xlsx` Excel exports, plus 10-step conflict-safe Import & Restore with rollback protection.
- **Permanent Blueprint Documentation**: Added 12 canonical specification documents in `ATK_DECK_SYSTEM_BLUEPRINT/`.
