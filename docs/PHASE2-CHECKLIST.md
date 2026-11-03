# Phase 2 checklist (tick as each slab is proven)

Mirrors `docs/BUILD-SLABS.md` (the source of truth for acceptance and proof) in the order it recommends. A box is ticked only when the proof was run; the note says by whom and when.

Legend: `[x]` proven · `[ ]` open · `(repo)` the repo docs say it is done, not re-run by this checklist's author · **Needs** = waits on the owner.

Order: **0, 4, 2, 1, 3, 5, 6, 7, 8**

## Slab 0: Green baseline
- [x] Tests pass (`npx vitest run`): 671 passed, 2026-11-03, fresh clone of `main` at `3425851`
- [x] Types pass (`npm run typecheck`, which runs `next typegen` first): no errors
- [x] Lint passes (`npm run lint`): clean
- [x] Browser smoke (`npm run smoke:ui`): passed 2026-11-03 on the Slab 2 backend commit `1d84efa`, together with `npx next build --webpack`

## Slab 4: Google sign-in (built and tested, live sign-in waiting)
- [x] (repo) Sign in with Google built, allow-list by connected account, secret server-side
- [ ] **Needs:** owner signs in once with Google
- [ ] **Needs:** one refused sign-in with a non-allowed account

## Slab 2: Hand-off after "DM sent" (next, needs nothing from the owner)
- [x] No job of any kind is planned or run for a lead at DM sent (`worker/runner.ts`, `lib/services/outreach.ts`, `lib/domain/stages.ts`; test "stops at dm_sent" in `tests/runner.test.ts`; 670 tests, types and lint green, 2026-11-03). Not yet run live.
- [ ] Follow up button, automatic reply checks and follow-up drafting removed (touches `app/`: Codex area, needs ACK)
- [ ] Replies page and "replied" wording removed or hidden (`app/`: needs ACK)
- [ ] Overview and Sheet show DM sent as the end of the line with a "handed over" label (`app/`: needs ACK)
- [ ] Browser smoke updated for the UI changes and green (smoke and build are green on the backend half; the UI half is not done)

## Slab 1: Extension live and verified
- [ ] After an app restart the extension is back online within 60 seconds, no manual action
- [ ] Timeout fix shipped and the extension updates itself
- [ ] One warm-up and one first DM complete on the test account
- [ ] **Needs:** one reload click on the extension, and the test Instagram account

## Slab 3: App matches the Phase 1 kit (owner ruled 2026-11-03: follow the kit, not the older three-message rule)
- [x] First DM: 1 to 3 messages, free-form goals-based prompt, only the Settings link allowed (at most two links), no dashes, banned stock/agency phrases, no invented facts in the prompt (`lib/engine/prompts.ts`, `lib/engine/validate.ts`, `lib/domain/writing-settings.ts`, `lib/domain/manual-first-dm.ts`, `lib/domain/local-ai.ts`)
- [x] Variety check against the last 10 sent first messages already existed (`recentSentTexts` limit 10) and is kept
- [x] Comment text rules: any length and any emoji count, no links/hashtags/dashes, no generic openers, max 300 characters; extension copy rebuilt (`lib/domain/warmup-comment.ts`, `extension/warmup.js`)
- [x] Prompts and settings stay editable; the DM prompt no longer has to contain `{link}`
- [x] Tests updated and green: 670 passed, types, lint, `next build --webpack` and `npm run smoke:ui` all pass (2026-11-03)
- [x] Warm-up behaviour: a visit now touches 2 to 5 posts picked at random from the newest 12 (never the grid from the top), every touched post is liked and about half also get a comment, the follow comes first or last, and the story is reacted to only sometimes (`lib/domain/warmup-plan.ts`, `worker/chrome-warmup.ts`; `tests/warmup-plan.test.ts`; 674 tests, build and smoke green, 2026-11-03). Not run live.
- [ ] Not built, deliberately: comment-only posts (a comment needs the like step's receipt check), the pinned-post half-chance, and honouring a `story_reactions` Settings switch (no such setting exists in the app yet)
- [ ] "No invented company facts" is only enforced by the prompt, not by code
- [ ] **Needs:** owner reads five sample first messages for five different profiles. These need a running writer (local Ollama model or Anthropic credit); neither exists on this Mac yet.

## Slab 5: Google Sheet module, one-way
- [x] One module owns all Sheets access: `lib/sheets/gateway.ts` is the interface, `lib/sheets/google.ts` the only code that calls the Sheets API
- [x] Five tabs (Leads, Settings, Jobs, Activity Log, Do-not-contact), header row locked, Stage dropdown with the nine stages: defined and tested in `lib/sheets/model.ts`; the request shapes for locking and the dropdown are tested with a fake fetch in `tests/google-sheets-gateway.test.ts`. Not run against a real Sheet.
- [x] Idempotent writes and retry: syncing twice changes nothing; a failed sync never throws, is recorded as `sheet_sync_error` and caught up on the next call; a failure halfway does not lose or double activity rows (`lib/sheets/sync.ts`, `tests/sheet-sync.test.ts`, fake Sheets client)
- [x] Only safe settings are shown (allow-list); formula-looking text is kept as text
- [x] Tests with a fake Sheets client: 685 tests, types and lint green, 2026-11-03
- [ ] Sheet matches the app within a minute of any change: `syncIfDue` (once a minute) exists but is not called by the worker loop yet, because no Google token source exists
- [ ] Username checked against the Sheet before any action: `sheetKnowsUsername` exists and is tested, not yet called before queueing or sending
- [ ] Sheets consent: the current Google sign-in asks only for `openid email profile`. A second consent for the Sheets scope, with the refresh token stored encrypted, needs routes and a button in `app/` (Codex area) and an owner click
- [ ] **Needs:** that one consent click, then a live run that creates the Sheet and mirrors the test lead's history, and a deliberate failure and recovery

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
