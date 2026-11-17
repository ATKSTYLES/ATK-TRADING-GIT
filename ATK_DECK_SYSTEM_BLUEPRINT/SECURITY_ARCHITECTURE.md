# ATK Deck V2 — Security Architecture

## 1. Authentication & Owner Isolation
- Uses Firebase Authentication (Google Sign-In via `signInWithPopup`) requiring verified emails (`request.auth.token.email_verified == true`).
- Zero public registration portals, commercial admin dashboards, or shared cross-user workspaces.
- Every Firestore path is strictly scoped under `/users/{userId}/...` where `request.auth.uid == userId`.

## 2. Hardened Firestore Rules (`firestore.rules`)
- **Default Deny Catch-All**: `match /{document=**} { allow read, write: if false; }`.
- **Blueprint Validation**: Every collection has a dedicated `isValid[Entity]()` helper verifying required keys, allowed keys (`hasOnly`), types, string lengths, and list bounds.
- **Query Enforcement**: Every `allow list` verifies `resource.data.userId == request.auth.uid`.
- **Parent Integrity**: `session_events` and `trade_events` verify `existsAfter(...)` on their parent `sessionId` / `tradeId`.
- **Audit Trail**: `audit_logs` are immutable append-only records (`allow update, delete: if false`).
- **Private Attachments**: Screenshots live under `/users/{userId}/attachments/{attachmentId}` accessible only to the verified owner.
- **Closed Trade Owner Updates**: Verified owners (`isOwner(userId)`) may retry or edit closed trades (`status == 'closed'`) with immutable `id`, `userId`, and `createdAt` protections enforced by `firestore.rules`.

## 3. Global Error Diagnostics & Sanitization
- Diagnostic entries are stored user-scoped in browser storage (`atk_deck_diagnostics_v1_{userId}` and `atk_deck_pending_ops_v1_{userId}`) and never contain auth tokens, emails, passwords, API keys, raw Firestore rules, or private trading journal/financial payloads (`sanitizeTechnicalMessage`).
