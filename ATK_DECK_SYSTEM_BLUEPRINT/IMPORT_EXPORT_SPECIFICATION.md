# ATK Deck V2 — Import & Export Specification

## 1. Export Capabilities
1. **Complete Backup (`ATK_Trading_Backup.zip`)**: Full ZIP archive containing all 15 entity collections, `manifest.json` with SHA-256 checksum, and binary image files under `attachments/`.
2. **Trading Records Scope**: Exports profile, accounts, daily journals, sessions, session events, trades, trade events, and trade groups.
3. **Selected Date Range Scope**: Filters journals, sessions, trades, reviews, linked events, and linked attachments to `[start, end]`.
4. **JSON Export**: Single machine-readable ATK-UTDS `.json` bundle.
5. **CSV Export**: Flat tabular export of all trade records (`ATK_Trades_YYYY-MM-DD.csv`).
6. **Excel Export (`.xlsx`)**: Multi-sheet Excel workbook (`Trades`, `Sessions`, `Daily Journals`, `Reviews`) generated via `xlsx`.

## 2. 10-Step Safe Import Workflow
1. Select `.zip` or `.json` backup file.
2. Validate archive structure and parse `manifest.json`.
3. Verify `format === "ATK-UTDS"` and apply version migration if needed (`0.x` → `1.0.0`).
4. Reconstruct binary attachments from `attachments/` and verify SHA-256 checksum.
5. Render Import Preview with detected record counts, attachment count, and unknown-field notices.
6. Detect duplicate IDs against existing workspace records and compare modification timestamps/content.
7. Allow per-record or bulk conflict resolution:
   - **Skip Existing**: Keep current workspace record untouched.
   - **Import as Separate Copy**: Generate new IDs and automatically remap `accountId`, `sessionId`, `tradeGroupId`, `tradeId`, and `entityId` references.
   - **Replace Existing**: Explicitly overwrite existing record after confirmation.
8. Require explicit user confirmation (`Confirm Safe Import`).
9. Commit parents (`accounts`, `sessions`, `trades`, etc.) before child timelines/attachments in chunked Firestore batches, tracking created document references.
10. Rollback automatically on any mid-import failure by deleting staged creations (never deleting pre-existing records) and log an `import_commit` or `import_rollback` entry in `audit_logs`.
