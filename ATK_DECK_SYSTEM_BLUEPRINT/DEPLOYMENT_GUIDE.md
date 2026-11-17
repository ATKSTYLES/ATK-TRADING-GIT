# ATK Deck V2 — Deployment Guide

## 1. Deployment Independence
- Frontend builds (`npm run build`) output static assets (`dist/`) and never reset, truncate, or reseed the Firestore database (`ai-studio-b30766e6-9ca4-40d6-a7be-c5479c185111` or configured Firebase project).
- Rebuilding, redeploying, or switching hosting providers leaves all personal records and attachments intact in Firestore.

## 2. Configuration Files
- `firebase-applet-config.json`: Contains public Firebase client configuration and `firestoreDatabaseId`.
- `firestore.rules`: Must be linted (`npx eslint firestore.rules`) and deployed whenever schema rules change.
- `.env.example`: Documents environment variables without embedding secrets.

## 3. Safe Publishing Checklist
1. Export a verified `ATK_Trading_Backup.zip` before any schema or major version upgrade.
2. Run `npm run lint` and `npm run build` to confirm zero TypeScript or bundle errors.
3. Deploy updated `firestore.rules` only after ESLint passes cleanly.
4. Confirm existing personal records load immediately after deployment.
