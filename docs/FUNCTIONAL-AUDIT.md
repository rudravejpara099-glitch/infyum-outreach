# Full functionality audit — 2026-10-21

The owner requests the whole app working, without intermediate questions. Completion remains unproven. This is an audit of the existing decided product, not permission to send messages, spend money, remove limits, change ownership, or add reply/booking automation. No worker or shared-data app server is running from this task.

## Current evidence

| Requirement | Evidence | State |
|---|---|---|
| Setup, login/error retention, protected routes | Expanded disposable browser suite; teammate created through Settings then signed in from a separate browser context | Verified locally |
| Create campaign, audience defaults, add leads, campaign review links/counts | Browser suite with real temporary SQLite rows | Verified locally; malformed input and broader editing still need audit |
| Approvals | Browser rejects edited disallowed link, approval after reply and forged retired-reply approval; valid approval/rejection persist | Verified locally at the action boundary; already-approved worker jobs still need final send guard |
| Team time zone | New authenticated save action validates supported IANA zones/UTC and aliases; browser persists Asia/Kolkata and rejects invalid zone | Verified locally; worker already reads setting for pacing |
| Lead notes/stages/stop | Browser persists notes, refuses forged illegal transition, accepts legal transition, invokes DNC and returns 404 for malformed ID | Verified locally |
| Shared standalone configuration | Official @next/env loaded in shared lib/config before config values; isolated processes prove .env loading/override precedence/test isolation; real standalone import reports configured DB/profile match | Verified without starting worker |
| Daily counters and timestamp persistence | Unchanged main baseline fails after calendar date changed: worker uses injected Oct 20; markSent uses SQLite Oct 21 | Failing, Claude ACK/fix requested in board #6 |
| Dashboard worker status | Real workerStatus query, manual check and visible-page refresh; browser flips live/stale heartbeat rows | Verified locally; does not start worker |
| Account controls | Browser creates saved account/profile path in temp directory, deduplicates account/login requests, saves cap, pauses/resumes; forged blocked resume rejected server-side | Verified locally; account save is not verified Instagram auth |
| Do not contact | Settings now invokes existing markDoNotContact for known leads; browser verifies skipped stage and DNC row, then removal | Verified locally; running external job race requires worker review |
| Activity CSV | Unit quote/formula tests and authenticated browser download/no-store/sign-out rejection | Verified locally |
| First real reply stops all work | Existing service clears future schedule; source send branch checks approval/DNC but does not exclude replied leads or retired reply kind | Incomplete protection: request backend review before live work |
| Daily limits, warnings, retries, restarts | Existing fake-driver tests except clock failure; UI now refuses warning reset | Real runtime/restart behavior remains unverified; uncertain external-action retries require review |
| Instagram readProfileNotes | Actual read-only driver against instagram’s public profile from saved account 3 | Returned public profile notes; does NOT prove authenticated session |
| Instagram readFacts / country / connection checks | Actual read-only diagnostics reached country step; public page showed login/signup dialog, no Options icon; all 3 saved cookie stores lack sessionid | Not verified. Guard misses logged-out public-page modals; manual sign-in and Claude guard/selector fix needed |
| Claude CLI | Installed; auth status diagnostic timed out without exposing credentials | Authentication/draft generation unverified; no draft was generated |
| Apify | Private config presence-only check: no token. Bounded/metered run hook still pending | No real run authorized or verified |
| Billing and payments | Separate draft PR #7 implements tested ledger/UI/SDK simulator; actual TEST credentials absent and worker hooks pending | Not operational; no live charges/calls authorized |
| Design | Operational screens inspected in both themes at narrow/wide; full browser loop checks overflow/reduced motion/focus | Verified for changed UI; not proof of live integrations |
| Production compilation | npx next build passed on readiness branch | Verified |

## Backend requests already posted

Board Codex #6 requests injected-clock persistence/daily rollover, safe retry helper, time-zone counter boundaries and billing integration. Additional evidence for Claude: `guard` only detects login URL; a logged-out public profile at `/instagram/` still passes. Followers/following lists without search are treated as false, so inability to check a relationship is indistinguishable from confirmed absence. `send` also needs a final first-reply/stage/kind guard, and restart retries must not blindly repeat a partially sent three-part DM or warm-up. A minimal unapplied clock patch is in docs/patches/clock-consistency.patch (`git apply --check` passes); it remains a proposal pending Claude ACK, not a tested backend implementation. These are existing locked rules, not new product decisions. No protected backend file was changed by Codex.

## Verification commands

- `npm test`: 82 passed / 1 failed, same pre-existing runner daily-limit clock failure as initial unchanged baseline (initial 72/1, ten new tests now pass).
- `npm run typecheck`: passed after removing ignored dev route types left by switching from billing branch.
- `npx next build`: passed.
- `npm run smoke:ui`: expanded suite passed with temporary database and profiles, no worker, no provider calls and zero outgoing messages. Includes actual Settings/account/lead actions, teammate sign-in, forged blocked-resume/illegal-stage/stale-approval/retired-reply rejection, valid approval/rejection and scoped CSV. Screenshots now cover 1440/1024/390px for every checked route in both themes. Browser console/page errors asserted empty. Screenshots use caret:initial because screenshot-injected caret hiding before React hydration caused a test-harness warning; corrected and rerun cleanly.
- Changed-file ESLint: passed. Full lint retains main’s existing prefer-const and unused-parameter findings.

No saved data was modified by the audit. Presence-only private configuration checks and read-only database counts were used; no secret/password/card data was printed or copied. The actual read-only browser updated its own existing profile cache and was closed. Shared preview remains stopped. The full goal stays active; this table is not a claim that the whole app is finished.
