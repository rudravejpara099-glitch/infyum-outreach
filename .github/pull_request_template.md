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
- [ ] CI is green
- [ ] Anything else you ran (screen checked in light and dark, smoke test, ...):

## NOT verified
<!-- Be explicit. Live Instagram, paid APIs and real sending are never run in a PR. -->

## Rules touched
- [ ] I changed a rule in `lib/domain/`: I added or updated a test for it.
- [ ] I changed the guide in `phase1/`: I re-read the whole file, removed any older line it contradicts, ran `npm run kit:check` and `npm run kit:lock -- "..."`, and updated `docs/kit-scenarios.json` if a safety behaviour changed on purpose.
- [ ] I added a migration: I appended a new one and did not edit a shipped one.
- [ ] None of the above.
