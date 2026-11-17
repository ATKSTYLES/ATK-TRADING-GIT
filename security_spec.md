# ATK Deck V2 — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. Every document in `/users/{userId}` and its subcollections belongs exclusively to the authenticated, email-verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. `userId` in every document MUST equal `{userId}` in the path and `request.auth.uid` on create, and MUST remain immutable on update.
3. Server timestamps (`createdAt == request.time` on create, `updatedAt == request.time` on create/update) enforce temporal integrity while `sourceCreatedAt` / `sourceUpdatedAt` preserve ATK-UTDS historical timestamps.
4. No unauthenticated read/write, no cross-user list scraping (`resource.data.userId == request.auth.uid` enforced on every `allow list`), and no shadow/ghost keys allowed (`keys().hasOnly(...)`).
5. Session events (`session_events`) belong strictly to an existing session (`exists()`), and trade events (`trade_events`) belong strictly to an existing trade (`exists()`), preventing orphaned events or context mixing.
6. `audit_logs` are append-only (no update/delete allowed).

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated read**: Anonymous client calls `getDocs(/users/userA/trades)` -> DENIED.
2. **Cross-user read**: `userB` calls `getDoc(/users/userA/trades/t1)` -> DENIED.
3. **Cross-user list scraping**: `userB` queries `/users/userA/trades` without matching owner -> DENIED.
4. **Unverified email write**: User with `email_verified: false` tries to create a trade -> DENIED.
5. **Identity spoofing**: `userA` tries to write `/users/userA/trades/t1` with `userId: "userB"` -> DENIED.
6. **Shadow/Ghost field injection**: `userA` writes `/users/userA/trades/t1` with extra `isAdmin: true` -> DENIED.
7. **ID poisoning**: `userA` attempts write with 500-char ID or invalid characters `../admin` -> DENIED.
8. **Timestamp forgery**: `userA` creates trade with client-forged `createdAt` not equal to `request.time` -> DENIED.
9. **Immutable field mutation**: `userA` tries to change `createdAt` or `userId` on trade update -> DENIED.
10. **Orphaned event**: `userA` tries to write a `trade_event` referencing a non-existent `tradeId` -> DENIED.
11. **Oversized attachment DoW**: `userA` tries to upload an attachment with `dataUrl.size() > 900000` -> DENIED.
12. **Audit log tampering**: `userA` attempts `update` or `delete` on `/users/userA/audit_logs/log1` -> DENIED.
