# Full functionality audit — 2026-10-21

The owner requests the whole app working, without intermediate questions. Completion remains unproven. This is an audit of the existing decided product, not permission to send messages, spend money, remove limits, change ownership, or add reply/booking automation. No worker or shared-data app server is running from this task.

## Current evidence

| Requirement | Evidence | State |
|---|---|---|
| Setup, login/error retention, protected routes | Expanded browser suite, blank-name rejection, teammate sign-in, cooldown and recovery; independent setup processes share a transaction | Verified locally |
| Production session secret | Pure phase tests plus actual next start refuses blank/default keys; generated key serves temporary setup page; build does not require the production key | Verified |
| Login throttling | Five attempts per normalized email in a 15-minute window, hashed/bounded temporary state, success reset and expiry tested through actual browser and SQLite | Verified locally; no passwords/IPs/tokens stored in the limiter |
| Safe backup | Native read-only SQLite backup tested under active WAL write, no source migrations, private/unique completed output and actual CLI fixture run | Verified on disposable data; no real-data backup/migration run |
| Campaign create/edit/start/pause, pasted handles and validation | Browser retains invalid form input, saves audience/sender, refuses start without sender, persists active/paused state and reports duplicate/invalid handles | Verified at UI boundary; worker must still recheck paused state before external actions |
| Lead-search queue | Disconnected key refuses enqueue; second disposable server with a fake key queues one active job per campaign and deduplicates repeats, permits another campaign; no worker runs | Queue boundary verified; actual provider/cost bounding remains unverified |
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
| Claude CLI | Privileged read-only auth status reports loggedIn true/claude.ai; two bounded unbilled fixture draft checks through existing engine failed | Cached sign-in does not prove working generation. No draft stored/sent; runtime generation remains unverified |
| Apify | Private config presence-only check: no token. Bounded/metered run hook still pending | No real run authorized or verified |
| Billing and payments | Separate draft PR #7 implements tested ledger/UI/SDK simulator; actual TEST credentials absent and worker hooks pending | Not operational; no live charges/calls authorized |
| Design | Operational screens inspected in both themes at narrow/wide; full browser loop checks overflow/reduced motion/focus | Verified for changed UI; not proof of live integrations |
| Production compilation | npx next build passed on readiness branch | Verified |

## Backend requests already posted

Board Codex #6 requests injected-clock persistence/daily rollover, safe retry helper, time-zone counter boundaries and billing integration. Additional evidence for Claude: `guard` only detects login URL; a logged-out public profile at `/instagram/` still passes. Followers/following lists without search are treated as false, so inability to check a relationship is indistinguishable from confirmed absence. `send` also needs a final first-reply/stage/kind guard, and restart retries must not blindly repeat a partially sent three-part DM or warm-up. A minimal unapplied clock patch is in docs/patches/clock-consistency.patch (`git apply --check` passes); it remains a proposal pending Claude ACK, not a tested backend implementation. These are existing locked rules, not new product decisions. No protected backend file was changed by Codex.

## Verification commands

- `npm test`: 103 passed / 1 failed, same pre-existing runner daily-limit clock failure as initial unchanged baseline (initial 72/1, thirty-one new tests now pass).
- `npm run typecheck`: passed after removing ignored dev route types left by switching from billing branch.
- `npx next build`: passed.
- `npm run smoke:ui`: expanded suite passed with temporary database and profiles, no worker, no provider calls and zero outgoing messages. Includes actual Settings/account/lead actions, teammate sign-in, forged blocked-resume/illegal-stage/stale-approval/retired-reply rejection, valid approval/rejection and scoped CSV. Screenshots now cover 1440/1024/390px for every checked route in both themes. Browser console/page errors asserted empty. Screenshots use caret:initial because screenshot-injected caret hiding before React hydration caused a test-harness warning; corrected and rerun cleanly.
- Changed-file ESLint: passed. Full lint retains main’s existing prefer-const and unused-parameter findings.

No saved data was modified by the audit. Presence-only private configuration checks and read-only database counts were used; no secret/password/card data was printed or copied. The actual read-only browser updated its own existing profile cache and was closed. Shared preview remains stopped. The full goal stays active; this table is not a claim that the whole app is finished.

## Remaining explicit requirements from the original build brief

Re-read the original MASTER PROMPT and README on Oct 21. The broad goal includes these unfinished items; successful form checks alone are not completion:

- Production secret guard, login throttle and safe read-only backup are now implemented and verified. Safe failed-job retry still needs Claude’s backend helper/uncertain-outcome rules; the UI must not blindly retry uncertain sends or warm-ups.
- Team time zone must govern daily limits and follow-up timing, not only pacing and display labels. Cross-midnight tests and the timestamp patch remain pending backend ACK. Keep current UTC counter labels honest until that is done.
- Original task E still needs CSV upload, a useful re-run-checks control within allowed stages, safe bulk approval, daily sent/first-reply campaign charts, and Settings visibility/control for the approved portfolio link and AI model. Never restore booked/call stages or reply drafting: the later first-reply ruling supersedes those older brief lines. The outbound portfolio link remains the single locked approved URL; changing it is not silently authorized by a Settings field. Do not ship an AI-model setting that the worker ignores.
- Backend must check campaign pause/state and selected sender immediately before executing queued jobs: source currently filters active campaigns when planning, but its approvedQueue and execution paths do not enforce campaign state. Pausing a saved row is not proven to stop an already queued send. Keep this distinct from the passing start/pause UI persistence checks.
- Actual Instagram authentication, facts/connection/inbox reads and a valid real internal CLI draft are not proven. Warm-up/send tests require the owner’s explicit permission for that step; none given here. Real paid API/Apify calls and live payments remain unauthorized. Actual Stripe TEST E2E and the reviewed billing/paid-engine hooks remain outstanding in PR #7.
- Every changed screen must keep the HIG/token direction and be checked at 1440/1024/390 in both themes. Required tests/typecheck/build and a PR are completion gates; the existing failing baseline blocks a ready PR. No protected backend area can be edited until board ACK/owner ruling.

Campaign changes passed production build and the expanded browser suite. Search queue happy/duplicate/different-campaign behavior uses a fake configured key in a restarted temporary server and no worker; it is not an Apify provider test. New queue helper tests persist real SQLite rows. Generic form navigation now uses Next router and avoids unnecessary same-route reloads; all custom forms explicitly use POST so password forms cannot fall back to GET.

## Security/reliability verification update

Tests were added red before implementing the secret/throttle/bootstrap/backup helpers. Production startup refuses unset/blank/short/public-placeholder secrets through the production-server config phase; dev/build remain usable without production credentials. The actual security smoke ran two refused production starts and one successful temporary start, not just a helper mock. Login consumes the counter transactionally before password verification, clears after success and bounds active records to 1,000. Unknown and known emails share the same error and normalized identity policy; hashes/counts only are persisted. Atomic first-user setup is tested from two separate Node processes, with only one created user. No automatic billing-owner inference is introduced.

Backup opens the source read-only/file-must-exist rather than openDb (which migrates), uses SQLite’s backup API for committed WAL data, writes private .partial output and publishes a unique completed file. Tests check no new app tables/source migrations, uncommitted data exclusion, mode 0600, concurrent unique files, missing-file refusal and the actual CLI against fixture data.

The extended browser suite passes setup validation, five failed logins, sixth-attempt cooldown, expiry recovery and successful normal login, plus prior full app controls. Cooldown screenshots were inspected in both themes at 1440/1024/390. A review run exposed an unbounded harness wait on Response.finished() after a server-action streaming response had already updated the form. Live fixture-process inspection proved the page had responded and password was empty while stream EOF remained pending; the diagnosed page was closed for cleanup, the harness now checks response arrival and bounded UI state, and the complete suite was rerun cleanly. No real passwords, bodies or headers were inspected/logged; the temporary debugger and test servers closed with the test process.

Commands: npm test currently 103 pass / unchanged one baseline clock failure (104 total); npm run typecheck, npx next build, node --import tsx scripts/security-smoke.ts, npm run smoke:ui and targeted lint pass. No protected backend source, shipped migration, real data, worker, real paid API, Apify or live payment changed.

Next: original task E CSV upload, safe bulk approval, daily sent/first-reply chart, re-run checks and genuinely wired model/approved-link settings. Before bulk approval, also tighten the individual approval boundary to its existing pipeline stage (first DM after warmed, follow-up after dm_sent) and adjust old synthetic UI fixtures to simulate warmed leads; current terminal-stage protection is necessary but not sufficient. Do not remove this requirement just because the older fixture shortcuts were green.
