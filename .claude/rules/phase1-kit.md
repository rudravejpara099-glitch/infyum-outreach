---
paths:
  - "phase1/**"
---

# Phase 1 kit rules (phase1/)

`phase1/GUIDE-FOR-CLAUDE.md` is not documentation. It is the prompt that real users' Claude runs against real Instagram accounts. A bad edit does not fail a test, it changes live behaviour. Treat every edit like a production change.

- **Edit in place. Never append a patch.** Find the section that already owns the behaviour and change it there. If a new line contradicts an old one, delete the old one in the same edit. The guide has grown by adding "never/always" lines on top of each other: do not add to that pile.
- **One rule, one place.** If you find the same rule in two sections, keep one and point the other to it (by section number).
- **After every edit, re-read the whole file** top to bottom looking for contradictions that a script cannot see.
- **Then run `npm run kit:check`.** It fails on: a reference to a section that does not exist, a column or setting name not defined in 5.2/5.3, a stage name that is not one of the five, follower ranges or the daily aim that disagree with each other or the README, a retired term, and any safety behaviour listed in `docs/kit-scenarios.json` that the guide no longer says.
- **Then record the change:** `npm run kit:lock -- "what changed and why"`. This bumps the version, stores the file's hash in `docs/kit-lock.json` and adds a line to `docs/kit-changelog.md`. `npm test` fails until you do, so no edit goes unrecorded.
- **Removing or rewording a safety behaviour on purpose?** Edit its entry in `docs/kit-scenarios.json` in the same change, and say why in the pull request. Never edit a scenario just to make a failing check pass.
- **Keep the guide one file at one URL.** Every user's Claude and every scheduled task fetches `phase1/GUIDE-FOR-CLAUDE.md` from the raw GitHub URL. Do not split it or move it without changing that URL everywhere (the README, section 7, `tests/phase1-kit.test.ts`).
- **Keep user-facing wording and hard rules consistent**: `0. How to behave` and `11. Never` must still agree with the section you changed.
- **Say what the change does in the pull request**, and which of these you checked: onboarding still asks only what it needs; nothing is sent without being logged first; hard rules unchanged unless the owner asked.
- Do not read or edit anything outside `phase1/` to decide what the kit should do. The kit never edits this repository.
- Never put real prospects, real usernames, passwords, keys or Sheet links in the guide. The team Sheet link is deliberately not stored here.
