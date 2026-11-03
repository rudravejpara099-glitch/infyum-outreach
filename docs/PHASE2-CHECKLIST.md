# Phase 2 checklist (tick as each slab is proven)

Mirrors `docs/BUILD-SLABS.md` (the source of truth for acceptance and proof) in the order it recommends. A box is ticked only when the proof was run; the note says by whom and when.

Legend: `[x]` proven · `[ ]` open · `(repo)` the repo docs say it is done, not re-run by this checklist's author · **Needs** = waits on the owner.

Order: **0, 4, 2, 1, 3, 5, 6, 7, 8**

## Slab 0: Green baseline
- [x] Tests pass (`npx vitest run`): 671 passed, 2026-11-03, fresh clone of `main` at `3425851`
- [x] Types pass (`npm run typecheck`, which runs `next typegen` first): no errors
- [x] Lint passes (`npm run lint`): clean
- [ ] Browser smoke (`npm run smoke:ui`) (repo: passed 2026-10-29)

## Slab 4: Google sign-in (built and tested, live sign-in waiting)
- [x] (repo) Sign in with Google built, allow-list by connected account, secret server-side
- [ ] **Needs:** owner signs in once with Google
- [ ] **Needs:** one refused sign-in with a non-allowed account

## Slab 2: Hand-off after "DM sent" (next, needs nothing from the owner)
- [x] No job of any kind is planned or run for a lead at DM sent (`worker/runner.ts`, `lib/services/outreach.ts`, `lib/domain/stages.ts`; test "stops at dm_sent" in `tests/runner.test.ts`; 670 tests, types and lint green, 2026-11-03). Not yet run live.
- [ ] Follow up button, automatic reply checks and follow-up drafting removed (touches `app/`: Codex area, needs ACK)
- [ ] Replies page and "replied" wording removed or hidden (`app/`: needs ACK)
- [ ] Overview and Sheet show DM sent as the end of the line with a "handed over" label (`app/`: needs ACK)
- [ ] Browser smoke updated and green

## Slab 1: Extension live and verified
- [ ] After an app restart the extension is back online within 60 seconds, no manual action
- [ ] Timeout fix shipped and the extension updates itself
- [ ] One warm-up and one first DM complete on the test account
- [ ] **Needs:** one reload click on the extension, and the test Instagram account

## Slab 3: App matches Dhrumit's process and the new first DM
- [ ] Warm-up rules match the Phase 1 kit (within daily limits)
- [ ] First DM rules match the kit; fresh hook per person; check against the last 10 sent; no invented company facts
- [ ] Prompts and settings stay editable
- [ ] Tests for the prompt and the variety check
- [ ] **Needs:** owner reads five sample first messages for five profiles

## Slab 5: Google Sheet module, one-way
- [ ] One module owns all Sheets access
- [ ] Five tabs (Leads, Settings, Jobs, Activity Log, Do-not-contact), header locked, Stage dropdown with nine stages
- [ ] Sheet matches the app within a minute after any change; idempotent writes; failures retried
- [ ] Username checked against the Sheet before any action
- [ ] Tests with a fake Sheets client; live run mirrors the test lead; deliberate failure and recovery
- [ ] **Needs:** one consent click granting the Sheets permission

## Slab 6: The Sheet as shared truth (two-way)
- [ ] Do-not-contact edit in the Sheet blocks that prospect in the app
- [ ] Stage cell edit updates the lead under the allowed-transition rules
- [ ] Conflicting edits: last change wins, with a log line
- [ ] One live edit round-trip

## Slab 7: Claude Sonnet 5.5 as the writer
- [ ] One real comment, one three-part DM and one fit score come from Sonnet 5.5; cost metered; monthly limit stops it; local writer stays as fallback
- [ ] **Needs:** the owner's decision to add API credit

## Slab 8: Launch test
- [ ] Five leads, Found to first DM, end to end on a spare account with approvals on
- [ ] One week at low volume, daily report clean (no warnings, no duplicates, limits respected)
- [ ] **Needs:** spare account, owner approvals, one week

## Working rules for every slab (from `docs/COLLAB.md` and `AGENTS.md`)
- Work on a branch, never `main`. Pull first. Pull request at the end.
- Claude owns `worker/`, `lib/domain/`, `lib/engine/`, `lib/services/`, `lib/leads/`, `lib/db/repos/`. Codex owns `app/`, `components/`, CSS, `scripts/ui-smoke.ts`. Post a request and wait for ACK before touching the other's area.
- Before a PR: `npm test`, `npm run typecheck`, `npx next build`.
- Add a dated entry to `docs/COLLAB.md` when stopping: what changed, what was verified, what was NOT verified.
