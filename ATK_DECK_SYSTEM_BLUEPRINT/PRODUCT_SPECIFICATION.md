# ATK Deck V2 — Product Specification

## 1. Purpose & Scope
ATK Deck V2 is a personal trading journal, session lifecycle logger, trade execution & psychology tracker, and universal data portability system (`ATK-UTDS`). It retains complete trading functionality while excluding all commercial/SaaS modules (pricing, subscriptions, payment gateways, customer management, marketing pages, or public registration).

## 2. Core Modules & Workflows

### 2.1 Dashboard
- Displays real-time, record-derived metrics: Daily summary, Monthly performance, All-time Net P&L, Win Rate, Profit Factor, Average R, Max Drawdown, Session Attendance, Discipline stats, Equity Curve, Recent Trades, and Recent Sessions.
- Never displays fabricated or placeholder telemetry.

### 2.2 Daily Journal (Live Input Workspace)
- Serves as the primary live trading-day input workspace keyed by `YYYY-MM-DD`, containing Daily Preparation, the upper **Session Logger**, and the lower **Live Trade Logger** with an explicit manual `SESSION LOGGER` | `TRADE LOGGER` context toggle.
- **Daily Header**: Selected date, prev/picker/today/next navigation, active timezone (`Asia/Kolkata` default), daily trading summary (sessions, trades, W/L/BE, net % or monetary P&L), and daily preparation checklist status.
- **Daily Preparation**: Day-level `DailyJournal` record persisting independently of individual sessions (never resets when starting a new session): Daily plan (`plannedActivities`), Daily notes (`morningNotes` + `dailyReflection`), Daily emotional state, Discipline rating (1–10), and persistent daily checklist (`Meditation`, `Exercise`, `Visualization`, `Oxygenation`, `Reading` + custom items).
- **Session Logger (Upper Panel)**: Independent session records (`planned` → `live` → `completed`, or `missed` / `cancelled`) using half-open `[start, end)` IST standard windows (`Asian 05:30–11:30`, `London 11:30–17:30`, `New York 17:30–22:30`) plus `Custom` sessions. Requires Pre-Session Check-In (sitting location, pre-session emotion + note, bias including `Neutral`, preparation notes), tracks `session_events`, and warns on end if live trades remain open without auto-closing them.
- **Live Trade Logger (Lower Panel)**: Always accessible directly below Session Logger, recording `before_entry` → `during_trade` → `closed` trades linked to `sessionId` or marked `isOutOfSession: true`, with percentage-first capture (`riskPercent`, `expectedProfitPercent`, `actualProfitPercent`, `tpOutcome`, `slOutcome`, `exitOutcome`), Anti-Bias Pause, and strictly separated `trade_events`. Entry/SL/TP prices and monetary P&L remain optional and distinct from `0`.

### 2.3 Daily / Session Records (Historical Record Page)
- Dedicated historical review page automatically displaying saved `daily_journals`, `sessions`, `session_events`, and linked `trades` entered via **Daily Journal** (never a second live logger).
- **Date Selection**: Displays saved Daily Journal record (checklist completion, daily emotions, plan, morning notes, closing reflection) and all sessions recorded on the selected date (or across All Dates), including attendance, status, duration, environment, and prep/closing notes.
- **Session Detail Drawer**: Displays complete session metadata, pre-session environment & emotion, session bias, preparation notes, `session_events` timeline, start/end times, duration, closing reflection, and all trades linked to that `sessionId`.

### 2.4 Trades (Independent Trade Records)
- Independent ledger displaying all `Trade` records (both in-session retaining original `sessionId` and Out-of-Session trades).
- Filters by Result (`all | win | loss | breakeven`), Lifecycle Status (`all | closed | during_trade | before_entry`), Session Context (`all | in_session | out_of_session`), and search.
- Trade Inspector drawer shows status, account, linked `sessionId` or Out-of-Session context, Risk % / Expected % / Actual Profit %, Realised R, optional entry/exit details & monetary P&L, `trade_events` timeline, psychology & 4 discipline questions, mistakes & lessons, and screenshots/attachments.

### 2.5 Calendar
- Monthly Monday-to-Sunday grid displaying: Profitable, Losing, Breakeven, Attended (0 trades), Missed session, No session planned, and No record.
- Displays daily P&L (or net % return when monetary P&L is unrecorded), trade count, and session attendance; monthly Financial, Activity, and Discipline summaries below; clicking any day opens **Daily / Session Records** for that date.

### 2.6 Analytics
- Four tabs: Financial, Activity, Discipline (including Process vs Outcome 2×2 matrix), and Psychology (Focused vs Distracted, Calm vs Anxious, Trades After Loss, Impulsive vs Planned, Confidence vs Results, Post-Exit Emotions).
- Always displays sample sizes (`n=`), excludes unrecorded values, and avoids equating correlation with causation.

### 2.7 Reviews
- Structured Daily, Weekly, Monthly, and Strategy reviews capturing Summary, Trading Mistakes, Lessons Learned, Behavioural Patterns, Improvement Goals, and Rating.

### 2.8 Settings & Export
- Profile, Trading Accounts, Checklists, Instruments, Timeframes, Session Templates, Logger Settings, Timezone, Currency, Light/Dark Theme, Universal Export (`ZIP`, `JSON`, `CSV`, `XLSX`), and 10-step Universal Import & Restore.
