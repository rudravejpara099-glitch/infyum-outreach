---
paths:
  - "lib/db/**"
---

# Database rules (lib/db/)

- SQLite through `better-sqlite3`. Keep it external to the bundle (`serverExternalPackages` in `next.config.ts`).
- **Never edit a shipped migration. Append a new one** in `lib/db/migrations.ts`. Before adding one, read the list to see the next free number.
- Use `lib/db/core.ts` from the worker and scripts, `lib/db/index.ts` from the web app only (it is `server-only`).
- Tests and smoke scripts use a temporary database. Never point a test at `data/outreach.db`.
- A migration needs a test that opens a fresh database and checks the result.
