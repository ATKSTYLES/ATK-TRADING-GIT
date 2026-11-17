# ATK Deck V2 — Project Structure

```text
/
├── ATK_DECK_SYSTEM_BLUEPRINT/      # Permanent 12-document system reference
├── firebase-applet-config.json     # Provisioned Firebase project & database ID
├── firebase-blueprint.json         # Firestore entity & collection IR
├── firestore.rules                 # Hardened owner-isolated Firestore security rules
├── security_spec.md                # Phase 0 adversarial security specification
├── eslint.config.mjs               # ESLint config for Firestore rules validation
├── index.html                      # Entry HTML + typography font links
├── metadata.json                   # Applet metadata
├── package.json                    # Minimal dependencies (react, firebase, jszip, xlsx, lucide-react)
└── src/
    ├── index.css                   # Tailwind v4 + @custom-variant dark + font tokens
    ├── main.tsx                    # React entry point
    ├── App.tsx                     # Root router + ErrorBoundary + Auth gate
    ├── context/
    │   └── WorkspaceContext.tsx    # Auth, live session/trade state, domain actions
    ├── domain/                     # Layer 2 & Layer 4 (Pure business logic & ATK-UTDS)
    │   ├── types.ts
    │   ├── defaults.ts
    │   ├── calculations.ts
    │   └── utds.ts
    ├── storage/                    # Layer 3 (Permanent Firestore persistence)
    │   ├── firebase.ts
    │   └── repository.ts
    ├── components/                 # Shared UI shell & guards
    │   ├── ErrorBoundary.tsx
    │   ├── LoginScreen.tsx
    │   └── SidebarLayout.tsx
    └── pages/                      # Layer 1 (Feature pages)
        ├── DashboardPage.tsx
        ├── DailyJournalPage.tsx
        ├── DailySessionRecordsPage.tsx
        ├── TradesPage.tsx
        ├── CalendarPage.tsx
        ├── AnalyticsPage.tsx
        ├── ReviewsPage.tsx
        └── SettingsExportPage.tsx
```
