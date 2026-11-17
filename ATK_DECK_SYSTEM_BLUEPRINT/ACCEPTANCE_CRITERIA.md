# ATK Deck V2 — Acceptance Criteria

Every future version of ATK Deck MUST satisfy all 15 criteria:
1. Complete trading functionality matching the Hyper Tracker reference workflow (Dashboard, Daily Journal live workspace with Daily Preparation + Session Logger + Live Trade Logger, Daily / Session Records historical viewer, Independent Trades ledger, Calendar, Analytics, Reviews, Settings & Export).
2. Consistent minimalist Notion-inspired light/dark design system (`DESIGN_SYSTEM.md`).
3. Strictly personal application (zero commercial billing, subscriptions, pricing, SaaS admin, or marketing pages).
4. Persistent, independently stored personal records in Firestore (`users/{uid}/...`).
5. Publishing a new frontend build never resets or overwrites existing records.
6. Changing hosting does not lose personal trading records or attachments.
7. Complete `ATK_Trading_Backup.zip` archive can be downloaded on demand.
8. Backup includes all 15 entities, relationships, timestamps, and binary attachments.
9. Backup can be imported cleanly into another compatible ATK Deck or Hyper Tracker instance.
10. Personal and commercial versions exchange data exclusively via manual export/import.
11. Zero live connection, shared database, or auto-sync between Personal and Commercial apps.
12. Original IDs, timestamps, timezones, and parent-child relationships survive export/import intact.
13. `ATK-UTDS` specification is documented and enforced (`ATK_UTDS_SPECIFICATION.md`).
14. Design system and 12-part blueprint remain up to date in `ATK_DECK_SYSTEM_BLUEPRINT/`.
15. Future redevelopment can rely directly on `ATK_DECK_SYSTEM_BLUEPRINT/` without inventing a new architecture.
