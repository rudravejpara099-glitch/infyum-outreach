---
paths:
  - "tests/**"
---

# Test rules (tests/)

- Vitest, files named `tests/<area>.test.ts`. Run all with `npm test`, one with `npx vitest run tests/<file>.test.ts`.
- A bug fix starts with a test that fails for the bug, then the fix.
- Never skip, delete or loosen a test to get green. If a test is wrong, say why in the pull request.
- Tests never touch real data (`data/outreach.db`), real Instagram or paid APIs. Use temporary databases and fakes.
- Report the real result ("87 files, 671 tests passed"), not "tests pass".
