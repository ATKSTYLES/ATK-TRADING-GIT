# ATK Deck V2 — Database Schema (Firestore)

## 1. Collection Hierarchy
All personal data is owner-partitioned under `/users/{userId}` in Cloud Firestore (independent of application runtime/container):

- `/users/{userId}` — `UserProfile`
- `/users/{userId}/accounts/{accountId}` — `TradingAccount`
- `/users/{userId}/daily_journals/{journalId}` — `DailyJournal`
- `/users/{userId}/sessions/{sessionId}` — `TradingSession`
- `/users/{userId}/session_events/{eventId}` — `SessionEvent`
- `/users/{userId}/trades/{tradeId}` — `Trade`
- `/users/{userId}/trade_events/{eventId}` — `TradeEvent`
- `/users/{userId}/trade_groups/{groupId}` — `TradeGroup`
- `/users/{userId}/attachments/{attachmentId}` — `Attachment`
- `/users/{userId}/session_templates/{templateId}` — `SessionTemplate`
- `/users/{userId}/checklists/{checklistId}` — `ChecklistDefinition`
- `/users/{userId}/instruments/{instrumentId}` — `Instrument`
- `/users/{userId}/preferences/{prefId}` — `UserPreferences`
- `/users/{userId}/reviews/{reviewId}` — `Review`
- `/users/{userId}/audit_logs/{logId}` — `AuditLog`

## 2. Temporal & Portability Dual-Timestamps
- **Database Integrity**: `createdAt` and `updatedAt` are Firestore server timestamps (`request.time`) validated by `firestore.rules`.
- **Portable Historical Integrity**: `sourceCreatedAt` and `sourceUpdatedAt` store ISO-8601 strings preserved verbatim across ATK-UTDS exports and imports.

## 3. Query Patterns & Indexes
- Every subcollection query filters explicitly with `where('userId', '==', uid)` so Firestore security rules validate list queries without `get()` fan-out.
- Single-field indexes on `userId` are automatically maintained by Firestore; client sorting handles multi-criteria filtering smoothly for personal ledger volumes.
