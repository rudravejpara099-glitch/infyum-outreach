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

## Slab 2: Hand-off after "DM sent" (done, not run live)
- [x] No job of any kind is planned or run for a lead at DM sent (`worker/runner.ts`, `lib/services/outreach.ts`, `lib/domain/stages.ts`; test "stops at dm_sent" in `tests/runner.test.ts`)
- [x] The Follow up button and step are removed (`lib/services/run-steps.ts`, Overview); the automatic reply checks and follow-up drafting no longer run; the "Send follow-ups" campaign checkbox is gone and new campaigns save it as off
- [x] The Replies page and "replied" wording are replaced: the page and menu entry are now "Handed over" (everyone at DM sent or Replied), the Overview shows a "Handed over" count instead of Replies and Reply rate, campaign cards say "handed over", and DM sent is labelled "Handed over" in the app
- [x] The Overview was looked at in the smoke-test screenshots (three buttons: Find leads, Engage, Send DMs; Handed over stat; Handed over menu entry)
- [x] Browser smoke updated and green; 702 tests, types, lint and `next build --webpack` all pass (2026-11-03)
- [ ] Still in the code and harmless: the `followupsEnabled` column, `draft_followup` and `check_inbox` job types and the History "first reply" chart, because removing them needs a migration and touches billing history. The Sheet still shows the stage name "DM sent" (it is the document's stage name)

## Slab 1: Extension live and verified
- [x] Live, 2026-11-03: the extension (0.3.2) paired with the app on this Mac and the app's "Check Chrome sign-in" confirmed `timelessmoments.al` as connected through it. This needed a fix: the extension had no answer for the `openLogin` command ("The extension cannot do this action yet"); it now opens the account's own profile in a background tab and reports signed in only if "Edit profile" is there (commit `aefe478`). Read-only; nothing was sent or clicked on Instagram.
- [x] After an app restart the extension is back online within 60 seconds, no manual action: measured live 2026-11-03, 15 seconds after the new app began starting. (An earlier "about 1 second" reading was wrong: the old server had not actually stopped, so the app never restarted.)
- [ ] Timeout fix shipped and the extension updates itself
- [x] Live, 2026-11-03, through the extension on `timelessmoments.al`: reading three real profiles worked (the app saw "already followed" and skipped them by its own rule), reading profile notes for first messages worked, the local writer produced three drafts that all stopped at the approval gate, and Reject worked. Nothing was sent.
- [x] One warm-up on a fresh lead, live, 2026-11-03: `@racefly` (public coach, 60.2k followers, not followed before) was qualified, then the extension did 3 likes, 1 comment and a follow from `timelessmoments.al`; Instagram afterwards showed "Following". The comment text: "The part about real lawsuits hits home,there is definitely a difference between gurus and operators who've actually been on the other side of that legal battle." (a bit stiff, and no space after the comma). The three earlier pilot leads were skipped by the "already followed" rule and then set aside.
- [x] One first DM sent through the extension, live, 2026-11-03 11:26 UTC: the owner approved a hand-written two-part message for `@racefly`, the Send DMs step dispatched it, and the app recorded it as sent and the lead as handed over. Not confirmed in Instagram's chat: right after the send, Instagram showed "We locked your account to protect you from a possible hack" for `timelessmoments.al` (recovery code needed). The kill switch was turned on at 11:27 UTC and everything is stopped.
- [x] Confirmed in Instagram afterwards (same day): the message is in the chat with Ryan Bacher ("You: Ryan, your point about gurus versus…"). The lock was cleared by the owner and the account profile loads normally again.
- [x] After the lock: human pacing is back ON by default (`worker/index.ts`; `HUMAN_PACING=off` turns it off), and Instagram's lock and challenge pages (`/auth_platform/`, `/challenge`, `/accounts/suspended`, "We locked your account…") now count as a hard stop in `worker/parse.ts` and the extension (`tests/parse.test.ts`; 704 tests, types and lint green).
- [ ] Slab 1 still open: the extension's timeout fix and self-update under real failure. Note for any further live run: `timelessmoments.al` has 0 posts and 10 followers, so it looks like a low-trust account to Instagram; a spare or warmed-up account is safer.
- [ ] **Needs:** one fresh, public lead whose account the test account does not follow yet, to prove the warm-up

## Slab 3: App matches the Phase 1 kit (owner ruled 2026-11-03: follow the kit, not the older three-message rule)
- [x] First DM: 1 to 3 messages, free-form goals-based prompt, only the Settings link allowed (at most two links), no dashes, banned stock/agency phrases, no invented facts in the prompt (`lib/engine/prompts.ts`, `lib/engine/validate.ts`, `lib/domain/writing-settings.ts`, `lib/domain/manual-first-dm.ts`, `lib/domain/local-ai.ts`)
- [x] Variety check against the last 10 sent first messages already existed (`recentSentTexts` limit 10) and is kept
- [x] Comment text rules: any length and any emoji count, no links/hashtags/dashes, no generic openers, max 300 characters; extension copy rebuilt (`lib/domain/warmup-comment.ts`, `extension/warmup.js`)
- [x] Prompts and settings stay editable; the DM prompt no longer has to contain `{link}`
- [x] Tests updated and green: 670 passed, types, lint, `next build --webpack` and `npm run smoke:ui` all pass (2026-11-03)
- [x] Warm-up behaviour: a visit now touches 2 to 5 posts picked at random from the newest 12 (never the grid from the top), every touched post is liked and about half also get a comment, the follow comes first or last, and the story is reacted to only sometimes (`lib/domain/warmup-plan.ts`, `worker/chrome-warmup.ts`; `tests/warmup-plan.test.ts`; 674 tests, build and smoke green, 2026-11-03). Not run live.
- [ ] Not built, deliberately: comment-only posts (a comment needs the like step's receipt check), the pinned-post half-chance, and honouring a `story_reactions` Settings switch (no such setting exists in the app yet)
- [x] "No invented facts" is now also checked by a second strict reviewer pass on the free writer (`criticPrompt` in `lib/engine/prompts.ts`, `lib/services/drafting.ts`): it rejects criticism of the person, claims about them the notes do not support, results or guarantees, agency-speak and guessed first names. A draft it refuses three times is kept only as a held draft with "Reviewer concern: …", never queued without a person. Paid (metered) calls skip the reviewer so they cost no more. Real-model run on five fictional profiles: all five were still held for a person, so the small local model is not good enough on its own.
- [x] Five sample first messages and comments were written by the real local model (`qwen3.5:latest` through Ollama) for five fictional profiles with `scripts/local-writing-samples.ts` (output in `data/local-writing-samples.json`, nothing sent, no paid call). Honest read: this small local model is uneven (it guessed a first name, mixed up who is in India, invented feelings in comments, and one profile got no valid comment). Quality with Claude Sonnet 5.5 is untested.
- [ ] **Needs:** the owner reads the samples and decides whether the local model is good enough or Slab 7 (Anthropic credit) comes first

## Slab 5: Google Sheet module, one-way
- [x] One module owns all Sheets access: `lib/sheets/gateway.ts` is the interface, `lib/sheets/google.ts` the only code that calls the Sheets API
- [x] Five tabs (Leads, Settings, Jobs, Activity Log, Do-not-contact), header row locked, Stage dropdown with the nine stages: defined and tested in `lib/sheets/model.ts`; the request shapes for locking and the dropdown are tested with a fake fetch in `tests/google-sheets-gateway.test.ts`. Not run against a real Sheet.
- [x] Idempotent writes and retry: syncing twice changes nothing; a failed sync never throws, is recorded as `sheet_sync_error` and caught up on the next call; a failure halfway does not lose or double activity rows (`lib/sheets/sync.ts`, `tests/sheet-sync.test.ts`, fake Sheets client)
- [x] Only safe settings are shown (allow-list); formula-looking text is kept as text
- [x] Tests with a fake Sheets client: 690 tests, types and lint green, 2026-11-03
- [x] Sheet matches the app within a minute of any change: the worker loop now runs the sheet cycle (`worker/index.ts` calling `runSheetCycle`) whenever a Sheet and a Google connection are set up; once a minute, and a failure is logged and never stops outreach. Tested with fakes only.
- [x] Username check against the Sheet: a username that is in the Sheet's Leads tab but unknown to the app is blocked in the app on the next cycle (`lib/sheets/from-sheet.ts`, `sheet.known_username`), and the Do-not-contact tab already flows in. Granularity is one minute, not "before every action".
- [x] Sheets consent built: `/api/sheets/google/start` and `/callback` (spreadsheets scope only, offline, PKCE, signed-in user checked first), the refresh token stored encrypted (AES-256-GCM, key from the server secret) in the workspace settings, a Settings section with Connect, Create the Sheet, Use an existing Sheet and Disconnect (`lib/sheets/oauth.ts`, `lib/sheets/connection.ts`, `tests/sheets-connection.test.ts`). 722 tests, types, lint, build and smoke green. Not run against real Google.
- [ ] **Needs:** the owner's Google client id and secret in `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), the redirect address `http://localhost:3000/api/sheets/google/callback` added to that Google client, one consent click, then a live run that creates the Sheet and mirrors the leads, and a deliberate failure and recovery

## Slab 6: The Sheet as shared truth (two-way)
- [x] A name added to Do-not-contact in the Sheet blocks that prospect in the app (closes or skips its lead; unknown names are blocked too; removing a name does not unblock): `lib/sheets/from-sheet.ts`, `tests/sheet-from-sheet.test.ts`, fake Sheets client
- [x] A Stage cell edit updates the lead along the app's allowed transitions only; a refused edit is logged (`sheet.stage_refused`) and the cell is put back by the next one-way sync; "Dead" on a messaged lead means Stopped; "Follow-up due" and "Call booked" stay as the person wrote them and are never overwritten
- [x] Conflicting edits: if both the app and the Sheet changed the same lead since the last sync, the person's edit wins when the app allows it, and a `sheet.conflict` line is logged. This is a rule I chose, because the Sheets API gives no edit time; it needs the owner's OK (see COLLAB #15)
- [x] One round = read people's edits first, then write the app's state, at most once a minute, and no write when the read failed (`lib/sheets/cycle.ts`, `tests/sheet-cycle.test.ts`)
- [x] 702 tests, types and lint green, 2026-11-03
- [ ] Same live needs as slab 5 (Google credentials and one consent click); then one live edit round-trip in a real Sheet

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
