## What and why
<!-- One or two sentences. Link the decision or issue if there is one. -->

## Area
<!-- Tick one. Mixed changes are hard to review and hard to undo: split them. -->
- [ ] Phase 1 kit (`phase1/`)
- [ ] Phase 2 app (`app/`, `lib/`, `worker/`, `extension/`, `companion/`)
- [ ] Docs, tooling or CI only

## Verified
<!-- Paste what you actually ran and what it printed. "Should work" is not verification. -->
- [ ] `npm run check` (typecheck, lint, tests): result:
- [ ] CI is green (skip until CI is enabled, see `docs/STATUS.md`)
- [ ] Anything else you ran (screen checked in light and dark, smoke test, ...):

## NOT verified
<!-- Be explicit. Live Instagram, paid APIs and real sending are never run in a PR. -->

## Rules touched
- [ ] I changed a rule in `lib/domain/` or the guide in `phase1/`: I added or updated a test or scenario for it, and removed any older line it contradicts.
- [ ] I added a migration: I appended a new one and did not edit a shipped one.
- [ ] None of the above.
