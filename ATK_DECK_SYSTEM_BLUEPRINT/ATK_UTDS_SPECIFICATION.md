# ATK Universal Trading Data Standard (ATK-UTDS) v1.0.0

## 1. Overview
`ATK-UTDS` is the canonical, versioned, application-independent data exchange standard shared by **ATK Deck Personal** and **Hyper Tracker Commercial**. Neither application shares a live database or communicates directly; all migration occurs via explicit user-controlled package export and import.

## 2. Standard Archive Package (`ATK_Trading_Backup.zip`)
```text
ATK_Trading_Backup.zip
├── manifest.json
├── profile.json
├── accounts.json
├── daily_journals.json
├── sessions.json
├── session_events.json
├── trades.json
├── trade_events.json
├── trade_groups.json
├── reviews.json
├── settings.json
├── templates.json
├── instruments.json
├── checklists.json
├── attachments_index.json
└── attachments/
    └── <attachmentId>_<sanitizedFilename>
```

## 3. Manifest Schema (`manifest.json`)
```json
{
  "format": "ATK-UTDS",
  "format_version": "1.0.0",
  "export_timestamp": "2026-11-17T03:30:00.000Z",
  "source_application": "ATK Deck V2",
  "source_application_version": "2.0.0",
  "export_scope": "complete_backup",
  "record_counts": {
    "accounts": 1,
    "daily_journals": 14,
    "sessions": 22,
    "session_events": 118,
    "trades": 35,
    "trade_events": 140,
    "reviews": 4
  },
  "attachment_count": 12,
  "checksum_sha256": "<hex>"
}
```

## 4. Universal Identifiers & Preservation Rules
1. Every record carries a globally unique ID (`UUID` or prefixed ID matching `^[a-zA-Z0-9_-]+$`).
2. Importing into an empty destination preserves original IDs, timestamps (`sourceCreatedAt`, `sourceUpdatedAt`, `entryTimestamp`, `exitTimestamp`), timezones, and parent-child relationships.
3. **Unknown Field Preservation**: Any unrecognized properties from newer or commercial schemas are stored in `unknownFields` (never silently discarded) and reported in the import preview.
