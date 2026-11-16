# 0002: The Phase 1 guide stays one file; checks go around it

Date: 2026-11-16 · Status: proposed in pull request `chore/kit-checks`

## Problem
`phase1/GUIDE-FOR-CLAUDE.md` (414 lines) was edited 18 times in 30 days, each time adding more "never/always" lines. Nothing checked that an edit kept earlier behaviour, so each real-user test could regress something that worked before.

## Options considered
1. **Split the guide into several files.** Easier to maintain, but every user's Claude and every scheduled task fetches the guide from one raw GitHub URL (README, section 7). A split means more fetches, and a failed fetch means missing rules while the kit runs on a real Instagram account.
2. **Keep one file and add checks around it.** Chosen.

## Decision
- The guide stays one file at one URL. `.claude/rules/phase1-kit.md` forbids moving or splitting it without changing that URL everywhere.
- `tests/phase1-kit.test.ts` (part of `npm test`) checks structure, references, names, numbers, the README and entry files, and safety scenarios in `docs/kit-scenarios.json`.
- Every edit must be recorded with `npm run kit:lock`, which stores a hash and a changelog line. An unrecorded edit fails the tests.

## Consequences
- Editing the guide takes three steps (edit, `kit:check`, `kit:lock`). That friction is intended.
- Checks are structural. Whether Claude behaves well when following the guide still needs a supervised real run.
- If the guide grows past what one file can hold, revisit: generate the single served file from smaller sources, and keep the lock on the generated file.
