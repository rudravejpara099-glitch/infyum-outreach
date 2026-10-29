# Build slabs: the road from here to launch

**Scope decision, 2026-10-29: the whole system stops after the first DM.** A human takes over from there, so follow-ups, reply reading and every stage after "DM sent" are out of scope (slabs 2 and 3 below are replaced accordingly). Source of truth for what is left to build and how each piece is proven. It follows Sunil's "Architecture and Build Plan". `docs/BUILD-PLAN-AUDIT.md` holds the original line-by-line gap list; this file is the current status and the work order.

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
| Chrome extension: read replies | ⛔ out of scope | Built but not needed: the system stops after the first DM. Stays dormant. |
| Reply tracking, follow-ups day 3 and day 7 | ⛔ out of scope | A human manages everything after the first DM (replaced by slab 2, the hand-off) |
| Warm-up and first DM as in Dhrumit's process and the Phase 1 kit | ⬜ | The Phase 1 kit was updated 2026-10-29; the app's writer and warm-up still use the older rules (slab 3) |
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
**Goal.** The extension stays connected and does warm-up and first DMs reliably.
**Acceptance.**
1. After an app restart the extension is back online within 60 seconds with no manual action.
2. It ships with the timeout fix (no network call can hang it) and updates itself.
3. A warm-up and a first DM still complete on the test account.
**Proof.** A restart test and one complete warm-up and DM on the test account.
**Needs.** One reload click on the extension (it froze before the timeout fix).

### Slab 2: The hand-off after "DM sent" (replaces reply tracking)
**Goal.** Once the first DM is sent, the system never touches that person again.
**Acceptance.**
1. After a lead reaches DM sent, no job of any kind (like, comment, follow, message, inbox read) is ever planned or run for it, in either run mode.
2. The Follow up button, the automatic reply checks and follow-up drafting are removed from the app; the Replies page and any "replied" wording are removed or hidden.
3. The Overview and the Sheet show DM sent as the end of the line, with a plain "handed over" label.
**Proof.** Tests that no job is created for a DM-sent lead; the browser smoke test updated; a look at the Overview.
**Needs.** Nothing.

### Slab 3: The app matches Dhrumit's process and the new first DM
**Goal.** The web app's warm-up and first message follow the same rules as the Phase 1 kit.
**Acceptance.**
1. Warm-up: follow, pinned-post comment, story like (reaction and poll as settings), question-based comments on reels, within the daily limits.
2. First DM: three separate messages from a one-line funnel note, soft or professional style (free-sample offer off by default), a fresh hook per person, and a check against the last 10 sent first messages; no invented company facts.
3. Prompts and settings are editable, as before.
**Proof.** Tests for the prompt and the variety check; five sample first messages for five different profiles read by the owner.
**Needs.** The owner reads the five samples.

### Slab 4: Google sign-in 🟡 (built and tested; live sign-in waiting on the owner)
**Goal.** People sign in with Google, as the document specifies.
**Acceptance.**
1. "Sign in with Google" works on the local app; the sign-in screen no longer asks for a password for Google users.
2. Only Google accounts that a team member has connected to their own account from inside the app can get in; any other account is refused with a clear message. (It never matches by email: registration is open and emails are not verified, so email matching would let someone pre-register a victim's address.)
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

`0 → 1 → 2 → 3` (extension and rules track) and `0 → 4 → 5 → 6` (Google track) can run in either order; slab 7 can slot in whenever the owner adds credit; slab 8 comes last and needs 1 to 6.

Recommended order: **0, 4 (built, awaiting the owner's sign-in), 2, 1, 3, 5, 6, 7, 8.** Slab 2 next because it needs nothing from the owner and removes work that is no longer wanted.
