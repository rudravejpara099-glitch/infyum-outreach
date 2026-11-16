---
paths:
  - "phase1/**"
---

# Phase 1 kit rules (phase1/)

`phase1/GUIDE-FOR-CLAUDE.md` is not documentation. It is the prompt that real users' Claude runs against real Instagram accounts. A bad edit does not fail a test, it changes live behaviour. Treat every edit like a production change.

- **Edit in place. Never append a patch.** Find the section that already owns the behaviour and change it there. If a new line contradicts an old one, delete the old one in the same edit. The guide has grown by adding "never/always" lines on top of each other: do not add to that pile.
- **One rule, one place.** If you find the same rule in two sections, keep one and point the other to it (by section number).
- **After every edit, re-read the whole file** top to bottom looking for contradictions and for section numbers that no longer exist (for example "section 5.4").
- **Keep user-facing wording and hard rules consistent**: `0. How to behave` and `11. Never` must still agree with the section you changed.
- **Say what the change does in the pull request**, and which of these you checked: onboarding still asks only what it needs; nothing is sent without being logged first; hard rules unchanged unless the owner asked.
- Do not read or edit anything outside `phase1/` to decide what the kit should do. The kit never edits this repository.
- Never put real prospects, real usernames, passwords, keys or Sheet links in the guide. The team Sheet link is deliberately not stored here.
