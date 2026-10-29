# Build slabs: the road from here to launch

Source of truth for what is left to build and how each piece is proven. It follows Sunil's "Architecture and Build Plan". `docs/BUILD-PLAN-AUDIT.md` holds the original line-by-line gap list; this file is the current status and the work order.

**How we work.** One slab at a time. A slab is finished only when every acceptance line is true and its proof has been run, not when the code exists. Each slab ends on `main` green (`npx vitest run`, `npx tsc --noEmit`, `npm run lint`) and is logged in `docs/COLLAB.md`. Anything that needs the owner is listed under **Needs**, up front.

Status key: ✅ done and proven · 🟡 built, not fully proven · ⬜ not started.

## Where the build stands against the document

| Document item | Status | Notes |
|---|---|---|
| Phase 1 locked (filters, comments, DM, columns) | ✅ | `docs/PHASE-1-LOCK.md` |
| Settings: every filter, daily caps, sender details, DM and comment prompts, active hours | ✅ | Slab 0 of this plan found no gaps; all editable |
| Rule filters + Claude fit score | ✅ | Fit score uses the local model today (see slab 7) |
| Claude-written comments and DMs, approve / edit / reject | ✅ | Local writer; Claude API needs credit (slab 7) |
| Four action buttons | ✅ | Overview page; default "buttons" mode |
| Apify lead search | ✅ | Proven live; spend limit follows Apify's billing cycle |
| Chrome extension: pair, poll, read, like, comment, follow, story like, DM, human pacing, kill switch | ✅ | Warm-up and DM proven live on real Instagram |
| Chrome extension: read replies | 🟡 | Built; not yet verified against the real inbox (slab 1) |
| Reply tracking | 🟡 | The document says manual in the MVP; automatic reading is built but not wired and proven (slab 2) |
| Follow-ups day 3 and day 7 | 🟡 | Rules done; not yet run through the extension (slab 3) |
| Daily caps, warm-up ramp, active hours, kill switch | ✅ | Caps per action, ramp on every action |
| Google sign-in | ⬜ | OAuth client exists; app still uses email and password (slab 4) |
| Google Sheet as the only store, five tabs, locked header, Stage dropdown, one module | ⬜ | App still uses SQLite (slabs 5 and 6) |
| Claude Sonnet 5.5 for writing | ⬜ | API key saved, balance is $0 (slab 7) |
| Test on a spare account, then a week at low volume | ⬜ | Slab 8 |

## Slabs

### Slab 0: Green baseline ✅
**Goal.** `main` is fully green and the status above is true.
**Acceptance.** Tests, types and lint pass; the browser smoke test (`npm run smoke:ui`) passes in isolation from the owner's real keys; this plan exists.
**Proof.** Done 2026-10-29: 657 tests, types, lint and the full browser smoke test (screens, themes, phone layouts) all pass. The smoke test was failing because the owner's saved Claude key leaked into it; it now isolates itself. A second "Save" button in Settings was renamed "Save mode" so the test can tell the buttons apart.

### Slab 1: Extension live and verified
**Goal.** The extension stays connected and reads replies correctly.
**Acceptance.**
1. After an app restart the extension is back online within 60 seconds with no manual action.
2. For the 5 most recent conversations, the extension's inbox read returns exactly the latest incoming message Instagram shows (or none).
3. Reading replies sends, types and changes nothing (read-only, checked in the activity log and the page).
**Proof.** A recorded run comparing the extension's output with screenshots of the inbox.
**Needs.** One reload click on the extension (it froze before the timeout fix).

### Slab 2: Reply tracking, end to end
**Goal.** When a prospect really replies, the lead moves to Replied by itself and the user is told.
**Acceptance.**
1. The worker's inbox check goes through the extension for connected accounts.
2. A real human reply sets the stage to Replied and shows on the Replies page; an auto-reply ("thanks for contacting us") does not.
3. A reply about price, contract or an upset tone is flagged for a human.
4. No message is ever sent in response.
**Proof.** Unit tests with a fake driver for 1 to 4, plus one live reply from the owner's second account to the test message.
**Needs.** The owner sends one reply from their account.

### Slab 3: Follow-ups through the extension
**Goal.** Day-3 and day-7 follow-ups are drafted, approved and sent through the extension.
**Acceptance.** A due follow-up is drafted once, shown for approval, sent as one message with no link, counted as one DM against the cap, and never sent if a real reply exists. Two follow-ups maximum; then the lead is marked Dead.
**Proof.** Tests with a controlled clock; one live follow-up to the owner's test account.
**Needs.** Owner approval of the live send.

### Slab 4: Google sign-in
**Goal.** People sign in with Google, as the document specifies.
**Acceptance.**
1. "Sign in with Google" works on the local app; the sign-in screen no longer asks for a password for Google users.
2. Only Google accounts on the team's allowed list can get in; any other account is refused with a clear message.
3. Existing data and workspaces are untouched; the old email-and-password login stays as a break-glass option, switchable off in Settings.
4. The Google client secret never reaches the browser.
**Proof.** Tests for the allow-list and the callback (state check, code exchange mocked); one live sign-in with the owner's Google account; one refused sign-in.
**Needs.** The owner signs in once. The OAuth client already exists (consent screen is Internal, so only the owner's organization's accounts can sign in).

### Slab 5: The Google Sheet module, one-way
**Goal.** Everything the app knows appears in one Google Sheet, through one module.
**Acceptance.**
1. A single module owns all Sheet access; nothing else touches the Sheets API.
2. The Sheet has the five tabs from the document: Leads, Settings, Jobs, Activity Log, Do-not-contact. The header row is locked and the Stage column is a dropdown with the nine stages.
3. After any lead, message or activity change, the Sheet matches the app within one minute. Writes are idempotent; a failure never breaks outreach and is retried.
4. The username is checked against the Sheet before any action (the document's duplicate rule).
**Proof.** Tests for the module with a fake Sheets client; a live run creating the Sheet and mirroring the test lead's whole history; a deliberate failure and recovery.
**Needs.** One consent click granting the Sheets permission (service-account keys are blocked by an organization policy, so this uses the signed-in Google account).

### Slab 6: The Sheet as the shared truth (two-way)
**Goal.** Edits in the Sheet flow back, so teammates can work from it.
**Acceptance.** Adding a name to Do-not-contact in the Sheet blocks that prospect in the app; changing a Stage cell updates the lead (with the app's allowed-transition rules); conflicting edits resolve by "last change wins" with a log line.
**Proof.** Tests for each rule; one live edit round-trip.
**Needs.** Nothing.

### Slab 7: Claude Sonnet 5.5 as the writer
**Goal.** Comments, DMs and fit scores can use Claude Sonnet 5.5, with a spending limit.
**Acceptance.** With credit on the key, one real comment, one three-part DM and one fit score come from Sonnet 5.5; cost is metered; the monthly limit stops it; the local writer remains the free fallback.
**Proof.** One real call of each kind and the metering record.
**Needs.** **The owner's decision to add credit** (a few dollars covers the test). Until then this stays blocked and everything else works on the local writer.

### Slab 8: Launch test (build plan step 8)
**Goal.** The document's own launch gate.
**Acceptance.** Five leads go from Found to the first reply, end to end, on a spare account with approvals on; then one week at low volume with the daily report clean (no warnings, no duplicates, limits respected).
**Proof.** The Sheet and activity log for the five leads and the week.
**Needs.** The spare account, the owner's approvals, one week.

## Work order and dependencies

`0 → 1 → 2 → 3` (extension track) and `0 → 4 → 5 → 6` (Google track) can run in either order; slab 7 can slot in whenever the owner adds credit; slab 8 comes last and needs 1 to 6.

Recommended order: **0, 4, 1, 2, 5, 3, 6, 7, 8.** Slab 4 first because it needs no extension and unblocks the Sheet; slab 1 as soon as the reload click is done.
