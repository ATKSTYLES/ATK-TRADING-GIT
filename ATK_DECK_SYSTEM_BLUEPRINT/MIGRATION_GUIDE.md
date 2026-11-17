# ATK Deck V2 — Migration Guide

## 1. Data-Format Upgrades (`ATK-UTDS`)
- Every package declares `format: "ATK-UTDS"` and `format_version: "X.Y.Z"`.
- Legacy `0.x` packages are automatically normalized to `1.0.0` during import preview.
- Newer or extended fields not yet in the core schema are preserved in `unknownFields` so data is never silently dropped.

## 2. Personal ↔ Commercial Cross-Application Migration
1. Export `ATK_Trading_Backup.zip` from the source application (ATK Deck Personal or Hyper Tracker Commercial).
2. Open Settings & Export → Universal Import & Restore in the independent destination application.
3. Upload the `.zip` archive, verify the manifest checksum and record counts, resolve any ID conflicts (`skip`, `copy`, or `replace`), and confirm import.
4. Both applications remain 100% independent afterward; subsequent edits do not propagate between them.

## 3. Schema Migration Rules
- Never run `DROP TABLE`, `TRUNCATE`, or destructive database resets during upgrades.
- Always snapshot a verified `ATK_Trading_Backup.zip` before changing `firebase-blueprint.json` or `firestore.rules`.
