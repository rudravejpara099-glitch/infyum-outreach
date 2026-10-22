# Handoff: Infyum Outreach (read this first)

You are taking over a half-finished internal web app. Everything below is decided. Do not re-litigate decisions, build on them. Keep the code simple and reliable: one language (TypeScript), small files, pure rules separated from I/O, tests on anything risky.

## What the product is
Instagram outreach for INFYUM (a funnel and landing page team in India). A campaign picks an audience; the app finds leads, checks them, warms them up (likes, comments, follow), sends three custom DMs, sends follow-ups, and stops at the lead's first real reply (scope ruling, Oct 20: our only job is getting the first message back; a person or the GoHighLevel agent handles the rest, not connected yet). Internal use by the company team only for now. Public version later (needs independently metered Anthropic API billing, see "Decided").

Business rules the code must keep:
- Lead qualifies only if: public account, based in the campaign country (from Instagram "About this account"), followers inside the campaign range (default 2,000 to 150,000), not connected to Infyum, never contacted, not on do-not-contact. Order of checks and wording of reasons: `lib/domain/qualify.ts`. Posting recency and engagement are deliberately ignored.
- Warm-up per lead: 10 pieces, like each, comment on each (3 to 8 words, 1 to 3 emojis, no dashes), religion/politics/grief posts like only, follow last.
- First contact is exactly three separate DMs, written fresh each time: (1) one true specific detail about them, (2) who we are (Rudra at Infyum, team in India) plus the only allowed link https://portfolio.infyum.com/sales-funnel, (3) one curious question. No guessed names, no invented results/prices, no dashes, no copied openings (similarity guard against the last 10 sent). Rules live in `lib/engine/prompts.ts` and `lib/engine/validate.ts`.
- Follow-ups: max 2, first after 2 days, next after 4, each adds something new, never "just checking in".
- Replies: answer what they said first, then one next step toward a call. Price, contract, dates, guarantees, partnership terms, legal and upset replies ALWAYS wait for a human (`lib/domain/sensitive.ts`), even with approval off. Partnerships: white label and affiliate only. Automatic "thanks for contacting us" replies are not real replies (`lib/domain/autoreply.ts`).
- Daily limit per Instagram account: default 35 with slow ramp-up (10, then 20, then cap), hard ceiling 60 (`lib/config.ts`). The worker stops an account the moment Instagram shows a warning or human check.
- No booking link or reply drafting in the app: that belongs to the human / GHL agent after the first reply.

## Decided (from a grill-me interview with the owner)
- Runs locally on the owner's Mac for now (localhost). Each connected Instagram account gets its own Chrome profile driven by Playwright; the owner logs in by hand once, the app never sees passwords.
- Earlier internal experiments used the local `claude` command. The later at-cost billing decision supersedes that for app-generated/billed writing: use the separately metered Anthropic API, never the owner's personal subscription. No paid provider call is authorized under the current no-spend instruction.
- Approval queue: on by default, switchable per campaign. Replies follow the same switch plus the always-human topics above.
- Pipeline stages: found, qualified, warmed, dm_sent, replied (hand-off), closed ("Stopped"), plus skipped (with reason). One transition table in `lib/domain/stages.ts`.
- Apify for lead search: free plan only, off until a monthly dollar cap is saved in Settings (`apify_monthly_cap_usd`). Stops at 90% of the cap. Never spend beyond the cap.
- Simple email + password login, one role, internal team of about 3 to 5.
- Extras in v1: global dedupe, do-not-contact list, similarity block, dashboard, CSV export of the action log.
- Look (owner revision, 2026-10-20): liquid-glass depth and fluid interactions, a plain “Outreach” app identity with no company logo, light/dark/system appearance, and HIG hierarchy/progressive disclosure. Plus Jakarta Sans and Inter remain. See `docs/DESIGN.md`. This supersedes the original flat, company-branded UI direction; outbound business identity and messaging rules are unchanged.

## Current live-workspace status (2026-10-22)

- Active campaign #4 is approval-on and assigned to `@timelessmoments.al` through the owner's signed-in Chrome profile. The app previously confirmed the Chrome session; this mode allows read-only qualification and approved sending but blocks warm-up likes/comments/follows.
- The local worker is running (PID recorded in its lease). It has two read-only lead checks (one for the moved test prospect) and one inbox check queued for the account's allowed work window, beginning 13:42 UTC / 7:12 PM India time. Do not change the saved schedule or turn on warm-up/social writes.
- Campaign #4 now contains 3 leads: two skipped and one untouched `@richcreditrepair` lead (17,400 saved followers, credit-repair niche) awaiting read-only qualification. Country and campaign fit are not verified until that check completes. The UI shows 23 messages pending approval, 0 DMs sent today, and 65 sent in the last seven days.
- The dashboard now explains the next scheduled task and labels five historical failed sign-in attempts instead of showing a generic failure warning. Those attempts are historical; `@timelessmoments.al` is connected through Chrome.
- Anthropic API, Apify, and Stripe TEST credentials are not configured. No paid API, Apify run, payment, Instagram message, like, comment or follow has been made; no money was spent.
- Latest local verification: 306 unit tests, typecheck, lint, Webpack production build, UI smoke, and local billing simulator pass. PR #13 is open/draft on `fix/first-run-operability`, latest commit `54783cb`; GitHub reports no status checks. These checks do not prove live qualification, DM sending, reply sync, paid provider calls or hosted operation.

## State of the code (historical implementation inventory; see current branch verification above)
Built and tested:
- `lib/domain/*` rules (stages, qualify, limits, similarity, approval, sensitive, autoreply)
- `lib/db/*` SQLite (better-sqlite3), append-only migrations in `lib/db/migrations.ts`, one repo file per table in `lib/db/repos/`
- `lib/services/*` flows: afterSent, handleIncoming, markDoNotContact, drafting (AI + validation + retry), findLeads (Apify)
- `worker/runner.ts` job orchestration (qualify, warmup, draft_dm, send, check_inbox, draft_followup, find_leads, open_login) tested end to end with a fake Instagram driver (`tests/runner.test.ts`)
- Screens: login/setup, dashboard, campaigns (list/new/edit/add leads/find leads), pipeline board, lead page, approvals, replies (hand-off list), accounts, activity (+CSV export), settings
- `scripts/import-csv.ts` imported the old spreadsheet (132 leads, 105 sent DMs) into `data/outreach.db`

NOT verified (these need the owner's account/provider setup):
1. `worker/instagram.ts` (Playwright driver) was written from memory of Instagram's UI and has never run against the live site. Selectors, "About this account" parsing, the followers/following search boxes, comment box, Message button, DM textbox and inbox reading all need a live check. Test read-only steps first (readFacts, readProfileNotes) before anything that likes, comments, follows or sends. Never retry past an Instagram warning: it must stop the account.
2. Paid AI drafting now uses the Anthropic API, not a personal Claude Code login. The provider key is not configured and no real paid request is authorized; fake-provider metering tests pass, but live usage is unverified.
3. `lib/leads/apify.ts` is tested only with canned data. First real run: confirm the actor id (`apify~instagram-search-scraper` by default, overridable via setting `apify_actor`), its input fields (`search`, `searchType`, `resultsLimit`) and output field names (`username`, followers).

## Next tasks, in order
1. Keep the worker running and inspect the live qualification result after 13:42 UTC / 7:12 PM India time. The queued job is read-only; do not accelerate it past its permitted account hours.
2. If the lead qualifies, continue only with user-reviewed manual warm-up/drafting. Approval remains ON; no real DM can be sent until the exact draft is approved in the app.
3. Keep paid AI, Apify, and Stripe calls off. The local billing simulator is the no-spend check; no live provider credentials are configured.
4. PR #13 remains open/draft with no automated checks. Do not merge or commit to main. Hosting and multi-company accounts remain deferred.

## Working rules
- Change a rule in `lib/domain/` first, run `npm test`, then look at the screen. Add a test for every rule you change.
- Never edit a shipped migration; append a new one.
- Every server action and page calls `requireUser()` first. Do not rely on `proxy.ts` for security.
- Next.js here is v16 (not what you remember): `proxy.ts` replaces middleware, `params`/`searchParams`/`cookies()` are async, `cacheComponents` is OFF on purpose (all pages `force-dynamic`), run `npx next typegen` after adding routes. Docs: `node_modules/next/dist/docs/`.
- Keep native `better-sqlite3` external (`serverExternalPackages` in `next.config.ts`). The worker and scripts run with `tsx` and import `@/` aliases; do not import `server-only` modules from the worker (use `lib/db/core.ts`, not `lib/db/index.ts`).
- Do not add dependencies without a reason. Do not add microservices, queues, or ORMs.
- Never store or log Instagram passwords. Never exceed daily limits. Never work around an Instagram block.

## Commands
```bash
npm install && npx playwright install chromium
npm run dev        # http://localhost:3000, first visit creates the first account
npm run worker     # background worker (separate terminal; APIFY_TOKEN optional)
npm test           # 52 tests
npm run typecheck
npm run import -- "<path>/engaged.csv"
```

## Where the old (manual) system lives
Folder `/Users/rudravejpara/ai work/Project instagram Lead Gen to Booking /Lead Gen/ig-run/` holds the original spreadsheet (`engaged.csv`), the written process (`DHRUMIT-PROCESS.md`, `RUN-PROFILE.md`, `REPLY-STYLE.md`, `BOOKING.md`) and Apify exports. Use them for context only; the app is the source of truth going forward.

## Liquid-glass workspace delivery (2026-10-20)

The owner explicitly asked to build the approved visual direction before the login-dependent live checks. Branch: `feat/liquid-glass-workspace`.

Changed:
- Shared responsive floating navigation, depth/material tokens, neutral Outreach identity, persistent light/dark/system appearance, keyboard focus/skip navigation, brief route/disclosure motion and reduced-motion support.
- Campaign detail now leads with audience and campaign-scoped waiting drafts. Progress, lead entry, latest profiles and settings are native disclosures. Existing controls still save real campaign data; no sample data is shipped in the product.
- Campaign counts are uncapped and preview only two oldest drafts. Review links filter Approvals to that campaign, including deep links. Oldest-first fetching keeps previews reachable even with over 100 waiting messages.
- Approval drafts have visible labels and content-sized textareas; pending submission feedback is included. Login errors retain non-secret fields. Passwords are not captured in client state.
- Replaced the Turbopack-only Tailwind development loader with the official PostCSS integration so the same styles compile with either Next.js bundler. No runtime dependency, migration, worker, outreach rule, limit or AI engine changes.
- Added a repeatable `npm run smoke:ui` using its own temporary database, user and server, without starting the worker. Screenshot artifacts go to ignored `data/ui-smoke/`. It never contacts Instagram or Apify.

Verification and remaining limits are recorded in `docs/UI-REVIEW.md`. Next work remains the owner's Claude login and Instagram connection, then read-only live verification in the original order. Warm-up and sends still require the owner's explicit confirmation for that step. Public hosting, multi-company tenancy and billing remain proposals/out of scope for this UI delivery.

### Local login follow-up (2026-10-20)
The owner's sign-in attempt exposed that the review server was still using the disposable `data/ui-review.db`. The production preview at port 3100 has now been restarted against the original database at `/Users/rudravejpara/ai work/infyum-outreach/data/outreach.db`, using a private, ignored `.env.local` with a new random session secret and the matching original profiles path. The original database had 132 imported leads and no users or campaigns at the time of reconnecting, so `/setup` is the intended next step for the owner to create their own local app account. A SQLite backup was saved to ignored `data/before-login-reconnect.db`. No password was requested, reset or displayed, and no worker was started. Keep the owner's data separate from the repeatable UI smoke fixtures.

## Parallel accounts (Claude, 2026-10-20)
Worker now runs one lane per Instagram account plus a shared lane (`worker/runner.ts`: `runOne(deps, lane)`, `runLanesUntilIdle`, `currentLanes`; `lib/db/repos/jobs.ts`: `claimNext(db, types?, lane?)`). New leads go to the least-loaded account (`leastLoadedAccount`). Tests: `tests/runner.test.ts` "parallel accounts". Still unverified with the real Playwright driver and real Instagram.

## Human pace (Claude, 2026-10-20)
Owner decision: keep volumes, act like a person. Rules in `lib/domain/pacing.ts` (hours, sessions, rests, lunch, gaps, human delays), enforced in `worker/runner.ts` for qualify, warmup, send and check_inbox jobs; browser movement in `worker/human.ts`. Setting `team_timezone` (default America/New_York) has no UI yet (asked Codex on the board). About 27 DMs per account per day at this pace. Not verified live.

## Full functionality work (Codex, 2026-10-21)

Owner requests autonomous completion of the entire app; the goal remains active and unfinished. Work is on `feat/workspace-readiness`, based on main f03ffe2, separate from draft billing PR #7. Current scope/evidence and remaining gates are in docs/FUNCTIONAL-AUDIT.md and board #6/#7.

Implemented and locally browser-verified: Team time zone Settings connected to the worker’s existing pacing setting; accessible form validation/pending/success feedback; teammate creation plus actual sign-in; DNC invoking existing stop-contact service; actual worker heartbeat display/check/refresh; account/login-request dedupe and honest queued-window feedback; cap/pause/resume controls with server rejection of forged blocked-account resumes; formula-safe authenticated activity CSV. All new inputs have boundary tests, and no protected backend folder, migration or dependency changed. Daily counts explicitly say UTC until backend team-zone counters are delivered. Campaign copy preserves stop-at-first-reply scope.

Checks: seven new unit tests passed; full suite 79 passed / 1 failed, same unchanged-main daily-limit failure discovered before code edits after calendar rollover (worker checks injected date; SQLite markSent persists wall clock). Typecheck, production build, changed-file lint and expanded UI smoke passed. UI smoke uses temporary DB/profiles and no worker; it covers persisted settings, teammate sign-in, DNC, account caps/pause/resume/duplicates/blocked tampering, CSV, auth, appearance/focus/overflow and empty console/page errors; zero outgoing messages. Screenshot caret instrumentation caused a hydration warning during a review run; fixed the harness to caret:initial and reran cleanly.

Actual read-only Instagram diagnostic used existing saved profile 3: public profile notes returned, then profile facts/country failed at the logged-out login/signup modal. All three saved profiles lack an Instagram sessionid cookie; saving an account is not proof of login. Driver guard currently misses this public-page login modal. No warning was bypassed and no like/comment/follow/send or inbox read ran. Browser closed; real DB was opened read-only for counts, no migration or user data writes. CLI auth status timed out; paid AI/Apify/Stripe credentials and explicit billing owner config remain absent. No paid generation/run/payment attempted; shared preview remains off.

Backend needs were posted first on the board and await Claude ACK/implementation: clock/daily-zone persistence, final send check after first reply, safe uncertain-outcome retries/restart recovery, explicit auth/relationship-read failures, diagnostic cleanup, and metered billing hooks. The full goal is not complete, and readiness changes are not claimed merge-ready while the mandatory baseline test fails. Continue independent UI work before asking the owner for final manual login/test setup; never enable live interactions or money from this general request.

### Further functional checks (Codex, 2026-10-21)

Approval edits now reuse the existing engine’s parse/draft rules, refuse stale/retired drafts and reject approval after a lead replied/stopped/DNC. Reject remains available for cleanup. Lead actions now show feedback, check legal stage transitions through the existing pure rule, persist notes and stop contact, and malformed lead IDs return 404. Browser coverage exercises actual actions, forged hidden values, rejection, forbidden links and retired replies; all changed routes are inspected at 1440/1024/390px in both themes. Removed the leftover booking-link description from campaign settings.

Found/fixed a shared startup issue without editing worker/: lib/config now calls Next’s official environment loader before reading config. The standalone worker/backup/import scripts previously did not load .env.local and could select a different database from the web app. Declared @next/env 16.4.2 directly (already installed with Next); reason: identical saved configuration and precedence across app and standalone processes. Three isolated-process tests pass for saved database/profile/provider loading, explicit overrides and test isolation. Real standalone import confirms saved database/profile config is now selected without opening the database or starting worker.

Latest checks: 82 unit tests pass / same 1 baseline clock test fails; ten new tests pass. Typecheck, production build, targeted lint, diff check and expanded browser suite pass, with zero outgoing messages/console errors. Candidate two-file clock fix is supplied as an UNAPPLIED patch at docs/patches/clock-consistency.patch; only git apply --check was run. It needs Claude ACK before protected source changes and must then be tested. The goal remains active and not complete. No ready-for-merge PR was opened for this readiness branch while the mandatory full-suite gate is failing. Continue remaining campaign/form/integration audit; board requests and manual auth/provider TEST setup remain unresolved.

### Campaign controls and full-spec audit (Codex, 2026-10-21)

Re-read original MASTER PROMPT and README, preserving later first-reply/design/billing rulings. The full objective also includes original security and product-completeness tasks D/E; these are explicitly outstanding in docs/FUNCTIONAL-AUDIT.md, not silently excluded as “just UI polish.”

Campaign create/edit now validates and retains errors, validates/deduplicates sender IDs and uses same-page/client navigation; starting without a sender refuses instead of silently stalling. Start/pause persist real rows with explicit worker status. Pasted handles report added/duplicate/DNC/invalid counts. Lead search validates campaign/cap/connection and deduplicates active searches per campaign transactionally. A fake-key, no-worker temporary review-server phase verifies enqueue/replay/different-campaign paths without contacting Apify. Generic forms use POST, including teammate passwords. Updated campaign copy to Active/Replies/handoff and corrected README’s inaccurate first-user-admin statement.

Checks: 87 unit tests pass / same 1 baseline worker clock test fails; fifteen new tests pass. Typecheck, production build, targeted lint and expanded browser suite pass, covering invalid campaign data, create/edit/start/pause, duplicate pasted leads, missing Apify connection, fake-key search queue/dedupe, prior form/auth/approval/lead controls and all three widths/both themes. No worker or external outreach ran. Queue helper extraction is tested against real in-memory SQLite rows. Cached CLI auth status reports signed in, but two bounded owner-internal CLI fixture draft checks failed; no billed API engine was used and nothing was saved/sent. Authentication presence is not working draft generation proof.

Still required: production secret guard, login throttle, CSV upload, bulk approval with existing review rules, daily sent/first-reply chart, meaningful re-run checks and functional approved-link/model settings. Time zone/daily boundaries, safe retry, real auth/driver fixes and billing hooks need Claude ACK. Additional backend issue: planning active campaigns does not protect already queued jobs; worker must recheck campaign state/sender before execution. The original build’s booked/reply features remain superseded by first-reply scope. Goal stays active, main unchanged, readiness branch not merge-ready while baseline fails.

### Security and backup verification (Codex, 2026-10-21)

Implemented original task D security in Codex areas: production-server phase rejects blank/short/public default SESSION_SECRET without echoing it; build/dev do not require a production key. Login reserves at most five attempts per normalized email per 15-minute window before password checking, using hashed identifiers/counts only in bounded temporary settings state (no passwords/IPs/tokens). Successful login clears the bucket. Public first-user setup checks/inserts under one immediate transaction; two independent setup processes prove only one creates a user. Setup rejects whitespace-only names and normalizes email.

Replaced the backup command’s migrating openDb call with a read-only native SQLite backup: source must already exist; committed WAL snapshot; private 0600 temporary output renamed only after completion; unique filenames and failure cleanup. No real source backup was run. Fixture tests verify source schema/user_version preserved without creating schema_migrations, active write transaction data excluded until committed, concurrent unique files and actual CLI operation in a temporary working directory.

Verification: all new security/backup tests pass; full suite 103 passed / same one baseline clock failure (104 total). Typecheck/build and real production startup smoke passed (blank/default refused, generated secret serves temporary setup). Expanded UI suite passes cooldown/expiry/success, setup validation, prior app controls and all three widths/light/dark. A stalled test was diagnosed through its live fixture process: the UI had returned its error/cleared the password, while the harness awaited streaming Response.finished indefinitely. Removed the EOF wait, added bounded UI state checks, reran cleanly; this was not treated as a stopped process/restarted solely on an observation timeout. Test/debug processes and servers cleaned up. No secrets or password values printed.

Next available work remains original E, explicitly listed in docs/FUNCTIONAL-AUDIT.md: CSV upload; permitted bulk approval and stricter existing pipeline-stage approval checks; daily sent/first-reply chart; re-run checks; functional approved-link/AI-model Settings. Original booked chart/reply handling remains superseded. Protected backend fixes, actual CLI generation, authenticated Instagram and actual Stripe TEST E2E remain incomplete. Keep the full goal active; do not claim 100% or ready-for-merge while baseline/other gates remain.

### Public deployment proposals only (Codex, 2026-10-21)

Multi-company isolation, broader roles, hosted workers, deployment/retention operations, account recovery and live payment enablement still require owner decisions and review. The approved billing work is TEST-only in PR #7, with no plans/tiers/subscription price, no service margin, and no personal-subscription resale. No new host/service or live charge is authorized here. Taxes and terms of service need a qualified person’s review before taking real money. The internal app still shares one workspace/role; the first app user is not an inferred billing owner. GoHighLevel integration and post-first-reply conversations/booking are not implemented by this scope.

### Spreadsheet import (Codex, 2026-10-21)

Campaign Add leads now accepts pasted handles and/or a CSV up to 500 KB, with a named username/handle/Instagram URL column or headerless single column. CSV parser supports BOM, CRLF, quoted commas/escaped quotes, refuses malformed/ambiguous/uneven rows before any writes, normalizes profile URLs and preserves global dedupe/DNC checks. File is not saved. Native labelled chooser, inline error/count feedback and narrow/wide layouts follow the repo HIG data-entry guidance. No protected source/dependency/migration changed.

Five new parser tests pass. Production build, typecheck, targeted lint and complete isolated UI suite pass; CSV UI proves malformed no-partial-import, header-only/oversize rejection, valid URL import, dedupe/repeat and DNC skip. Both themes at 1440/1024/390 captured, dark phone/light tablet inspected; fixed stretched search controls found in visual review. Unit suite includes five additional in-progress chart tests: 113 pass / same one baseline clock failure, not merge-ready. No worker/provider, real data write or outgoing message. Charts remain next; all previous unverified/backend/live restrictions still apply.

### Campaign history, review safety and re-run checks (Codex, 2026-10-21)

Campaign progress shows actual 14-day counts by team local date: sent first contacts/follow-ups and first real replies, with a compact accessible bar view and expandable exact-count table. Reply aggregation counts the earliest recorded lead.handoff once; no booked/reply-drafting stage. Empty data stays explicit. Tests cover time-zone midnight/DST/offsets, campaign scope, historical handoffs and non-real replies. Isolated browser fixture rows were removed before zero-sent assertion.

Approval now checks pipeline stage: first contact only after warm-up; follow-up only after first DM, while enabled and under the existing two-follow-up max. Bulk approval applies the same checks to every selected edited draft, validates sensitive/similar flags against current edits and batch text, bounds selection to 100, and approves atomically. Added status feedback remains visible after the final row leaves the queue. Browser covers stale-action refusal then successful reviewed edits. Existing tests continue to verify message/link rules.

Skipped-to-found now appears as “Re-run checks”. The action uses the existing stage transition and refuses DNC, any sent/incoming/handoff history, or a missing campaign. Copy explains work only starts with active campaign and running worker. Added three action tests.

Verified: npm run smoke:ui passed complete disposable-browser flow, screens at 1440/1024/390 both themes, no worker/providers, zero outgoing sends; npm run typecheck, npx next build, targeted ESLint and diff check passed. npm test: 125 pass / 1 unchanged main baseline worker date failure (126 total). No protected source, migration, dependency, paid provider, shared data or production credentials changed. The repo requires the full suite to pass before a PR; these changes remain uncommitted while the pre-existing baseline failure is being resolved through the board. The CSV importer alone is already committed/pushed as 2fab7e8.

Still open: Claude’s clock/send/pause/sender/restart/auth/meters hooks; model setting needs a real CLI integration rather than a placebo; no actual signed-in Instagram session/CLI draft, paid API, Apify or Stripe TEST E2E verified. Continue independent checks; no real message or expense is authorized.

### Protected entry-point regression check (Codex, 2026-10-21)

Added `tests/auth-boundaries.test.ts`, which discovers every protected app page/loading screen, non-public server action and protected route handler and verifies `requireUser()` is the first statement. Logout now checks the session before clearing it; login and initial setup remain public. The focused test passes, and the disposable browser smoke passed setup/login/logout and app workflows with zero messages sent. The current suite is 127 passed / one failure (128 total), still the unchanged daily-limit clock mismatch reproduced before these changes. Typecheck, `npx next build --webpack`, changed-file ESLint and diff check pass. Default Turbopack remains blocked by the sandbox's local port-binding restriction. A read-only check found all three saved Instagram profiles still lack a sessionid cookie; only cookie presence and account status were inspected. Outstanding backend ACK and live provider checks remain unresolved; no money or messages were used. The full-suite gate remains red, so this branch is not merge-ready.

### Daily-limit timestamp correction (Codex, 2026-10-21)

Fixed the mismatch where the worker counted against its injected date but `markSent` saved SQLite wall-clock time. `afterSent` now passes the same UTC instant to `markSent`, which persists that time. The daily-cap test now proves two sends are recorded on Oct 20 and the third queued send proceeds on Oct 21, even when the host clock is already on Oct 21. Repository coverage queries the injected date, and both runner/repository test files close their in-memory databases after each test. This is the narrow daily-limit issue the owner directed me to fix; it does not finish team-time-zone boundaries or other backend safeguards.

Verified: `npm test` = 128 passed; `npm run typecheck`; `npx next build --webpack`; isolated `node --import tsx scripts/ui-smoke.ts` passed with temporary data and no outgoing messages; changed-file ESLint had 0 errors and one pre-existing warning; `git diff --check` passed. Full suite is green again. The app still has unverified real Instagram authentication, AI generation, Apify and Stripe TEST interactions; no paid call or message was made. Readiness branch changes remain under review and are not yet a completed SaaS deployment.

### Plain-language workspace pass (Codex, 2026-10-21)

Updated navigation, pipeline stages, campaign review, activity history, message types/statuses and campaign form labels to use everyday wording while preserving stored identifiers. Added tested copy helpers and updated the browser smoke selectors/assertions. No campaign rules, database schema, dependencies, external services or sending behavior changed.

Verified: `npm test` = 131 passed; `npm run typecheck`; `npx next build --webpack`; the full local Playwright smoke passed with a disposable database and no messages sent; changed-file ESLint and `git diff --check` passed. The initial smoke attempt exposed an old selector for “Qualified”; it now checks the new “Matches” label. Live Instagram/provider/payment behavior remains unverified.
## At-cost billing implementation (Codex, 2026-10-20)

The owner approved all Q1–Q9 recommendations and the plan in draft PR #7. Branch `feat/billing-at-cost`; merged updated main through `f03ffe2`, keeping its first-reply handoff scope, Replies wording, human pacing and reliability code. The earlier billing deferral is superseded for this task. Main remains untouched by Codex; migration 1 is unchanged. Migration 2 is claimed here/on the board and appended for this unmerged feature.

Implemented in Codex’s areas: exact integer micro-dollar ledger and immutable rate/evidence/statement history, explicit consent/payer attribution, atomic cross-process reservations and 90% cutoff including fees/fixed commitments, unknown-outcome holds, exact model/cache rate snapshots, confirmed fixed-expense allocation, UTC statements/grace, disclosed carry/rounding/processor adjustments, owner-only configuration and model prices, scoped CSV, responsive light/dark Usage and billing/admin/statement pages, and official Stripe SDK TEST-only hosted checkout with signed/deduplicated webhooks. The SDK is the only added dependency. Checkout total is frozen; actual fee differences appear on the next statement. No automatic debit, tiers, subscription, live payment path or personal Claude billing fallback.

Verification after main integration: `npm test` = 120 passed; `npm run typecheck` passed; `npx next build` passed (the first sandbox build failed to bind a local compiler port; clearing the ignored Turbopack cache and retrying with tool approval passed). `npm run smoke:billing` passed with a disposable database and local provider simulator: consent/limit save, 1440/1024/390px in both themes, declined/successful hosted redirects, signed duplicate events, one payment, fee reconciliation, scoped CSV, other-user admin/statement rejection and signed-out protection. `npm run smoke:ui` passed, including zero outgoing messages. Separate-process reservation race is tested; a new Apify race test includes settlements arriving during aggregate measurement. `npm audit --omit=dev --audit-level=high` found zero vulnerabilities. Full lint currently reports main’s existing `tests/pacing.test.ts:31` prefer-const error and `tests/runner.test.ts:19` unused-parameter warning; no lint finding is in new billing code. Main’s existing dev lint dependency chain also has five high audit findings; forcing an old Next lint major is not an appropriate fix.

NOT complete/verified: operational worker/paid API/Apify metering. Claude’s implementation and board ACK remain pending, requested in Codex #3/#4/#5 and docs/BILLING-INTEGRATION.md. No protected backend folder was authored by Codex. Billed campaign starts, paid reservations and payer assignment remain blocked until reviewed integration is recorded. Actual Stripe TEST-account checkout/decline/signed delivery/real balance-transaction reconciliation is also unverified: test key, webhook secret and owner ID are not configured on this machine. The passing loopback simulator is explicitly not Stripe. PR #7 remains draft and is not claimed merge-ready while these required checks are missing. No real payment, paid AI, Apify run, Instagram action or worker was started. The owner’s real database/configuration are preserved and the port-3100 preview remains stopped.

Next: Claude ACKs/implements the published worker contract; reviewer verifies hooks before recording readiness. Privately configure TEST-only Stripe credentials and explicit owner ID, then verify against an actual TEST account. No real paid provider call is authorized by this implementation. Fixed expense/model/processor seeds are planning figures only; ordinary users see recorded costs. The placeholder token arithmetic is $0.63 for 100k input plus 22k output at $3/$15 per million; do not invent a higher charge to match the rough planning range. See docs/BILLING.md for setup, payment and testing details.

## Combined readiness and billing verification (Codex, 2026-10-21)

Branch `feat/platform-integration` combines the existing readiness branch and test-only at-cost billing branch for integration verification. Campaigns retain the CSV/validation/plain-language work and include billing payer/readiness guards. The local billing smoke now also removes the fixture integration marker and verifies that a billed campaign cannot start or queue lead search until reviewed hooks are recorded; database rows remain draft and no search job is created. The fixture marker is restored only inside the disposable test.

Checks: `npm test` = 178 passed; `npm run typecheck`; `npx next build --webpack`; `node --import tsx scripts/ui-smoke.ts`; `node --import tsx scripts/billing-smoke.ts`; targeted lint and diff checks pass. Default Turbopack build fails with the sandbox internal-port EPERM; Webpack production build succeeds. Both browser suites use temporary databases and local simulator only.

Still unverified: Claude-owned paid AI/Apify/worker metering and runtime safety hooks, team-zone daily counters, read-only authenticated Instagram behavior, real CLI draft generation and real Stripe TEST webhook/fee reconciliation. No worker, paid provider, payment or outgoing message ran. Do not mark the SaaS complete until these are verified and remaining owner-only account setup is complete.

The local CLI status reports a signed-in Claude account. A synthetic fixture call returned a valid three-part draft through the CLI engine and passed the app's parser/rule checks without persistence. This verifies basic generation only; it does not verify drafting from a real lead, billed API mode, worker dispatch or Instagram behavior.

### Campaign status consistency and current sign-in check (Codex, 2026-10-21)

Campaign list and detail now share plain labels: Draft, Active, Paused, Finished. The list previously exposed the internal lowercase `done` value. Added a focused label test. No campaign data, database schema or protected source changed.

Verified: 193 tests, typecheck, Webpack production build, targeted ESLint and `git diff --check` pass. A local preview was restarted on port 3100 using the existing `.env.local`; no outreach or paid call ran. The latest `claude auth status --json` still reports `loggedIn=false` even though the immediately preceding `claude auth login` printed `Login successful`; resolve this discrepancy before relying on CLI drafting. The browser tool denied access to the local page, so the latest campaign-label render was not visually inspected in this run.

NOT verified: read-only Instagram driver behavior, account authentication, live Claude drafting, worker safety/metering, Apify or Stripe TEST behavior. No social action, AI prompt, paid call or payment ran.

Needs from you (Claude), NEEDS ACK: existing #37 dispatch-time checks, safe recovery, Instagram authentication lifecycle and usage metering requests remain open. A safe Finish/Stop UI must wait for the worker to guarantee that already-approved queued messages stop before it promises that behavior.

Next: investigate the Claude CLI status mismatch without asking the owner to repeat sign-in; continue safe UI work; wait for board ACK before protected worker/service/repository edits.

### Dashboard setup checklist (Codex, 2026-10-21)

Added a plain-language three-step checklist to Overview: connect and manually sign in to Instagram, start the worker on this computer, and prepare a campaign. It distinguishes a saved account from a verified Instagram login and reflects the actual account, worker heartbeat and workspace lead counts. The browser smoke now checks the empty-workspace guidance. No sending, billing, worker or account rules changed.

Verified: `npm test` = 178 passed; `npm run typecheck`; `npm run smoke:ui` passed with a disposable database and zero messages sent; `npx next build --webpack`; targeted ESLint and `git diff --check` passed. The first sandbox attempt could not create the test runner's local socket; retrying with local-server permission passed.

### History empty state (Codex, 2026-10-21)

History now explains what will appear when there are no activity records and gives a direct path to create the first campaign. The message uses a semantic heading and the design tokens. The UI smoke clears only its own temporary activity table before checking this state, then captures 1440/1024/390px in light and dark.

Verified: `npm test` = 178 passed; `npm run typecheck`; `npm run smoke:ui` passed with disposable data and zero outgoing messages; `npx next build --webpack`; targeted ESLint and `git diff --check` passed. A concurrent build/typecheck attempt briefly raced on generated `.next/types`; the sequential typecheck passed.

### Pipeline empty states and filter validation (Codex, 2026-10-21)

The Pipeline now offers the right next step when there are no leads in the workspace or selected campaign, labels empty stages clearly, and explains when no leads were skipped. A malformed or unknown campaign filter returns 404 instead of silently switching to all campaigns. This is a UI/query-boundary fix; campaign and lead rules are unchanged.

Verified: `npm test` = 178 passed; `npm run typecheck`; `npm run smoke:ui` passed with disposable data and no outgoing messages; `npx next build --webpack`; targeted ESLint and `git diff --check` passed. The UI smoke captured and inspected the empty board at 1440/1024/390 in both themes and verifies both malformed and unknown campaign IDs. Its intentional local-server restart ignores only the expected HMR connection refusal during that restart.

### Atomic Settings changes (Codex, 2026-10-21)

Settings actions now commit each data change and its audit row in one SQLite transaction for teammate creation, do-not-contact add/remove, Apify cap and team time zone. A failed write returns the same clear retry feedback used by other forms. The browser smoke injects SQLite trigger failures for teammate creation, DNC add, cap save and time-zone save, then proves all underlying rows roll back and successful retries still work.

Verified: `npm test` = 178 passed; `npm run typecheck`; `npm run smoke:ui` passed with disposable data and no outgoing messages; `npx next build --webpack`; targeted ESLint and `git diff --check` passed. This checks transaction and feedback behavior only; it does not run a worker or paid provider.

### Isolated worker startup check (Codex, 2026-10-21)

Started the worker against a new disposable SQLite database with no accounts, leads, or jobs and an empty Apify token. It wrote a fresh heartbeat, queued no work, and exited cleanly on SIGINT. No browser profile was opened and no Instagram, Claude, Apify, or payment action ran. This verifies idle startup and heartbeat only; it does not verify jobs or provider integration.

### Dashboard and lead empty states (Codex, 2026-10-21)

Dashboard recent activity and lead conversation/history now explain what will appear when empty. The UI smoke captures desktop/tablet/phone in both themes and passes with isolated data. Verification: all 178 tests, typecheck, Webpack production build and UI smoke pass. No send, provider call or payment occurred.

### Authenticated production smoke (Codex, 2026-10-21)

Expanded `scripts/security-smoke.ts` to verify first-user setup, all primary protected routes, sign-out, protected-route redirect, and sign-in against `next start` with a disposable database. Passes after a clean `npx next build --webpack`; no worker, provider, payment or outreach action. Default Turbopack currently panics at the sandbox local-port boundary.

### Isolated smoke build outputs (Codex, 2026-10-21)

Dev smoke servers now get validated per-run build directories and throwaway TypeScript configs, so UI and billing browser suites can run while the local app server stays open and cannot edit the project's `tsconfig.json`. Smoke cleanup waits for each server to exit before deleting its temporary build and config. The UI smoke ignores only the known localhost resource/RSC fallback errors during its intentional Next dev-server restart. Path rules are unit-tested. UI smoke and billing simulator both pass with this isolation, and a Webpack production build passed in a disposable build directory. No data, profile, paid provider or Instagram action was used. Normal app runs still use `.next` and `tsconfig.json`.

### Accounts login-request feedback (Codex, 2026-10-21)

Fixed the account row hint so it reports “The worker is handling this request” while its heartbeat is current and “Waiting for the worker to start” when stale. Added pure-copy tests and browser smoke assertions for both heartbeat states, with mobile/tablet/desktop overflow and screenshots. The live Accounts page rendered the new current-heartbeat message. The smoke suites now use isolated Next build output and temporary TypeScript configs so they run while the preview and pending `open_login` job stay undisturbed. Unit tests, typecheck and full UI browser smoke pass.

The full application remains incomplete. The live login window is not visible in the available browser inventory, and no sign-in is confirmed. No Instagram write action or paid provider/payment action ran.

The requested `open_login` job for account row 1 has since completed after one attempt, but read-only profile inspection found no Instagram `sessionid` cookie in any of the three saved profiles. The job completing is not evidence that sign-in worked. No additional login task was queued. The worker remains alive and idle; campaigns are drafts and no outreach jobs are queued or running. See board entry #30 for the protected `open_login` lifecycle request; no worker/driver code was changed.

### Cost-only billing enforcement (Codex, 2026-10-21)

Removed the owner-configurable margin from billing settings and statements. Billing calculations, persisted schedule writes and reads force the retained migration column to zero; old nonzero schedule rows do not add a margin to new statements. User pages and CSV no longer show a margin line. Migration 2 remains unchanged. Unit regression and browser simulator cover normal and legacy nonzero settings. Latest suite: 188 passing tests, typecheck, billing browser simulator and disposable Webpack build passed. This does not verify the worker’s paid usage hooks or an actual Stripe TEST account.

The latest isolated production smoke also passed against a temporary build/database: unsafe session secrets were refused, setup created a user, all primary protected routes loaded, sign-out redirected correctly, and sign-in succeeded. It did not start a worker or call Instagram, a provider or a payment processor.

### Current live-workspace recheck (Codex, 2026-10-21)

Read-only inspection of the existing authenticated preview on port 3100 showed 202 leads, a worker heartbeat reported as running, 23 drafts awaiting approval, and one failed background task. Activity describes the failure as `open_login replaced by the owner signed-in Chrome`. Accounts shows three saved accounts and correctly distinguishes saving an account from confirming Instagram login. All three campaigns are drafts. Billing is in Test mode with $0 recorded, paid work off, and the shared Apify limit unset. The latest inspection did not open a login window, approve or send a draft, change account settings, or alter workspace data. Instagram session status remains unverified; see `docs/COLLAB.md` #33 for Claude's requested login-lifecycle review.

`npm test` passes (188 tests), `npm run typecheck` passes, and `git diff --check` passes. At that point, the UI smoke did not run successfully in this environment because its temporary Next server exited before startup. The test runner now captures a bounded, redacted diagnostic; the current run identifies the sandbox's denied bind to `127.0.0.1:3190`. A branch push was also unavailable because this environment could not resolve `github.com`; the recent local branch commits remain ahead of `origin/feat/platform-integration` until network access returns. No money, provider calls, payment, or outbound Instagram action occurred.

### Self-hosted design fonts (Codex, 2026-10-21)

The default production build previously needed Google Fonts network access. Switched Next 16 to `next/font/local` and included the existing cached Latin Inter and Plus Jakarta Sans variable files with their SIL Open Font License. This keeps the approved typography while removing the build-time Google Fonts request and avoids adding a package. The authenticated preview rendered the Accounts page with the new local font setup. `npx next build --webpack` passes; standard Turbopack build now reaches compilation without a font/network error but still hits the sandbox's internal-port permission panic. No outreach, paid API, Apify or payment action ran.

### UI smoke startup diagnostics (Codex, 2026-10-21)

The UI smoke runner now captures only the child server's stderr on failure, limits it to 4 KB, and redacts its temporary session secret, directory and fixture Apify token. A current run shows the environment error: the sandbox denies listening on `127.0.0.1:3190`. The smoke test therefore still cannot execute here; it cleaned up its temporary database/build/config and no persistent app data changed. `npm test` (188), `npm run typecheck`, and `git diff --check` pass. No provider, payment, worker, or outbound Instagram action ran.

### Activity task error copy (Codex, 2026-10-21)

Activity now displays everyday labels for known background tasks instead of internal task codes. The observed sign-in-window replacement error has a plain-language explanation; unknown task types use a neutral fallback. Focused tests cover known labels, fallback, and the mapped sign-in error. This changes presentation only and does not retry or reopen Instagram. Latest verification after the change: `npm test` = 189 passing, `npm run typecheck` and an isolated `npx next build --webpack` pass. The authenticated preview displays the new text in its accessibility tree. The disposable browser smoke still cannot start because the sandbox denies its localhost bind. No worker, profile, payment, provider, or Instagram action ran.

### Current CLI sign-in status (Codex, 2026-10-21)

A fresh local `claude auth status --json` check reports `loggedIn=false`. This supersedes the older signed-in status in the historical combined-verification entry; the previous synthetic draft result does not prove current CLI access. No prompt, generation, login window or app data change was attempted. Do not queue AI writing until Claude CLI is signed in and the output is verified.

### Accounts sign-in outcome visibility (Codex, 2026-10-22)

The Accounts page now shows the latest sign-in-window request per account as waiting, opening, opened, or failed, with the existing error translated into plain language. An opened window is explicitly not described as proof of an authenticated Instagram session. Added pure-copy tests; no protected backend files, account data, worker, provider, or Instagram actions were changed. Verified: 194 tests, typecheck, and `git diff --check` pass. Live Instagram sign-in remains unverified; the browser smoke was not run in this turn.

### Short end-to-end check and live connection state (Codex, 2026-10-22)

The local UI smoke now targets the new account sign-in status separately from the action-result banner; this keeps the test unambiguous. Disposable UI smoke passed through setup/login, campaign and account controls, approvals, settings, responsive layouts, and worker heartbeat states. Disposable billing simulator and production authentication smoke also passed. `npm test` (194), typecheck, Webpack production build, changed-file ESLint, and `git diff --check` passed. These checks use temporary databases and a fake payment provider; no money, external provider, worker, or Instagram action was used.

Read-only status check of the owner's configured workspace found a stale worker heartbeat, Claude CLI `loggedIn=false`, no Apify token, three saved Instagram accounts with sign-in still unverified, one active campaign with zero leads, and 23 drafts pending approval (zero approved messages). The local Stripe test credentials are not configured. Starting the worker against the owner's database/profile was denied by this environment's filesystem/network permission boundary; the read-only live Instagram check therefore remains unverified. Do not call the app fully connected based on these local simulator results.

### Host Claude login resolved; restricted status differed (Codex, 2026-10-22)

The earlier `loggedIn=false` result came from the restricted execution context. In the normal local Mac context, `claude auth status --json` exits 0 and reports `loggedIn=true`, `authMethod=claude.ai`; the app's `claudeLoginState()` helper also returns `signed_in`. The owner does not need to repeat sign-in. The actual prompt-generation test remains unrun because it would consume the owner's subscription quota; no AI call was made. A brief real-worker run is still not approved by the automatic review because the worker can process Instagram work rather than guarantee inbox-only behavior.

### Campaign finish now gates queued work (Codex, 2026-10-22)

The campaign page now offers a separate Finish campaign action with a confirmation prompt and an explanation of its effect. Finished campaigns are terminal through the server action. The worker now checks campaign state and sender assignment when it processes lead work, lead searches and sends; the approved-send planner only queues messages for active campaigns with an assigned sender. This prevents queued sends from dispatching after a campaign is finished. A message already inside the external send call may still complete; the UI says so. Approved drafts remain saved but are not sent while the campaign is finished. Added regression tests for finishing a campaign with a send already queued and for rejecting a forged restart request.

Verified: `npm test` passes (196 tests), `npm run typecheck`, `npx next build --webpack`, targeted ESLint and `git diff --check`. The browser smoke test could not be completed: its disposable local server started but stopped responding, so I stopped the run and cleaned up the temporary server. No Instagram, Claude, Apify or Stripe call ran; no message was sent and no money was spent.

Still unverified: the owner’s live Instagram sessions, real Claude drafting (would use the owner's Claude quota), real Apify usage, Stripe test checkout, live worker execution, and browser-level confirmation of the new Finish control. No credentials or account state were changed.

### Message send recovery and campaign state guards (Codex, 2026-10-22)

The Instagram driver now marks a multi-part send uncertain as soon as it attempts the first Enter action. The worker stops automatic retries for uncertain sends, records a failed task, and exposes the outcome on the lead page. The owner can confirm all parts were sent or confirm none were sent and return the message to individual approval; partially sent messages stay held for manual handling. A worker restart also holds a send job whose message was still approved, while recognizing a message already recorded sent. Known pre-send failures keep the bounded retries and then stop without creating fresh endless send jobs.

Finished campaigns now reject new lead imports, lead searches and message approvals; lead searches require an active campaign. The worker rechecks campaign state and sender assignment on dispatch, and review rechecks the campaign state and assigned sender. The Finish control confirms its effect and warns that an in-flight send may complete.

Verified: `npm test` passes (208 tests), `npm run typecheck`, `npx next build --webpack`, targeted ESLint and `git diff --check`. The disposable full browser smoke was attempted but stalled after its test server started and did not return responses; it was stopped and the server cleaned up. No Instagram, Claude, Apify or Stripe call ran; no message was sent and no money was spent.

Still unverified: browser-level flow for the new controls, owner Instagram authentication, real Claude drafting, real Apify usage, Stripe TEST checkout, and the real worker. The local app remains the only target; no hosted deployment was attempted.

### Final local end-to-end smoke (Codex, 2026-10-22)

The full disposable browser smoke now passes through setup and sign-in, campaign creation, adding leads, campaign-scoped approval, account login-request feedback, campaign pause/resume/finish, worker status, settings and caps, DNC, responsive layouts, keyboard access, and theme behavior. Fixed the test fixture to create one sample account before the dashboard/account checks, and to set campaign state explicitly before lead-search and pause/resume checks. Added an opt-in `UI_SMOKE_SCREENSHOTS=0` setting to skip saving screenshots while retaining all browser assertions.

Verified after these changes: all 208 tests pass, `npm run typecheck`, `npx next build --webpack`, targeted ESLint, `git diff --check`, and the complete disposable UI browser smoke. The UI smoke reports that no messages were sent. No Instagram, Claude, Apify, Stripe or other paid-provider calls ran; no money was spent.

Still unverified: the owner's live Instagram sign-in/session, real Claude drafting, real Apify usage, Stripe TEST checkout, and live worker execution. These require owner sign-in or connected credentials and explicit approval for any live/paid operation. This local verification is not evidence that those integrations are connected, and no deployment was attempted.

### One-click Instagram sign-in window (Codex, 2026-10-22)

The Accounts page no longer requires the full outreach worker to open a sign-in window. Connecting or reopening an account creates/reuses one `open_login` job, claims it before launching a detached local process, and prevents duplicate windows. That process accepts only the claimed account/job IDs, validates the job is an in-progress `open_login`, and invokes only `PlaywrightInstagram.openLogin`; it does not plan or process campaign work. A stale sign-in request older than 20 minutes is marked failed so the owner can retry. The child receives only PATH, HOME, NODE_ENV, DB_PATH and PROFILES_DIR; no provider token, password, or session secret is forwarded. The action still requires `requireUser()` first and clearly tells the user to sign in by hand.

Verified: 220 tests pass, typecheck and Webpack production build pass, targeted ESLint and `git diff --check` pass. The full disposable browser smoke passes; its test environment deliberately leaves the sign-in job queued and never launches Instagram. Unit tests exercise account-action process launch arguments, duplicate-request handling, and the login-only job refusing campaign work. No message, like, comment or follow was made; no paid service or payment was used.

Still unverified: a real account window launched by the new Accounts action, successful hand sign-in/session persistence, live worker execution, Claude draft generation, Apify usage, and Stripe TEST checkout. A single hand-sign-in window opened earlier directly against a saved profile is still awaiting the owner; do not start the full worker while it is open. The CLI auth status is signed in, but the owner's Claude quota is exhausted, so no generation was attempted. Apify and Stripe credentials are absent and lead search remains off.

Needs from owner: sign in by hand in the currently open Instagram window and close it; then we can verify session presence without reading or logging the cookie value. Do not send any password or token in chat.

### Instagram sign-in confirmation (Codex, 2026-10-22)

The sign-in window now watches only for the presence of Instagram's `sessionid` cookie while the Instagram page is not on a login or challenge URL. It never saves or logs the cookie value. When the cookie appears, the window closes and the login job records a simple authenticated true/false result in its existing payload. The Accounts page distinguishes confirmed connection, incomplete sign-in, and legacy “window opened” jobs. This shared login-only check is used both by the Accounts button and normal worker login jobs. The dashboard and Accounts page now explain that account sign-in can work while campaign processing waits for the background service.

Verified: `npm test` passes (223 tests), `npm run typecheck`, `npx next build --webpack`, targeted ESLint, and `git diff --check`. Tests cover cookie-presence classification, rejecting login/challenge pages, job outcome recording, and user-visible status. The latest disposable browser smoke could not be reverified: normal startup was blocked by the sandbox's local IPC restriction, and an elevated attempt stalled before completion; it was stopped and all temporary files were cleaned. The earlier smoke run passed before this sign-in-status change. No real Instagram session was available to verify live; no worker campaign work, like, comment, follow, or send ran. No paid provider or payment ran.

Still unverified: whether Instagram's current login flow creates the expected session cookie in this environment, successful owner sign-in, real Claude drafts (owner quota exhausted), Apify, Stripe TEST, and live worker campaign processing. The saved profiles previously had no session cookie. The owner must sign in through Accounts and refresh the page to see the result.

### Full no-spend application check (Codex, 2026-10-22)

Fixed two verification issues found during the full browser run: campaign `<details>` disclosures can be opened natively by URL-fragment navigation before hydration, so those disclosure elements now tolerate that expected browser mutation; the UI smoke also waits for the intentional dev-server restart socket error before leaving its expected-restart window. The billing simulator now seeds an already-active campaign after removing its metering acknowledgement, so it actually exercises the billing gate rather than a disabled draft-state button.

Verified on this branch: `npm test` = 223 passing, `npm run typecheck`, isolated `npx next build --webpack`, targeted ESLint, `git diff --check`, full `UI_SMOKE_SCREENSHOTS=0 npm run smoke:ui`, `UI_SMOKE_SCREENSHOTS=0 npm run smoke:billing` with a fake local processor, and `node --import tsx scripts/security-smoke.ts` against the isolated build. The UI flow covers setup, login, campaigns, CSV/lead entry, approvals, account controls, settings, themes/responsive layouts and protected routes; billing simulator verifies test-only fee reconciliation and access controls. No real worker, Instagram action, paid provider call or payment ran.

Read-only live workspace check: 1 active campaign and 4 drafts, all with approval on; 3 saved Instagram accounts; 23 outgoing drafts await approval; 105 messages already have sent status; no campaign or send jobs are queued/running. Worker heartbeat is stale. Two of three profile cookie databases were inspectable and had no current Instagram session cookie; the third had no inspectable cookie database. This check did not alter any account or message data. Apify and Stripe credentials are absent. Do not start the worker while the active campaign and unreviewed leads remain; that could begin campaign actions. No real Instagram login or Claude message generation is verified.

Owner help needed: sign in to one account through the Accounts page and refresh to confirm its status. Real AI generation requires available AI access; Apify and Stripe live checks require credentials and separate spending approval. No password or token should be sent in chat.

### Paid AI path without personal Claude login (Codex, 2026-10-22)

Owner decision #40 authorizes Codex to finish the protected backend work without waiting for Claude. Removed the personal Claude CLI engine and sign-in check from Settings. Worker drafts, retries, follow-ups and warm-up comments now use the Anthropic Messages API path; each call requires an explicit campaign/account payer, a bounded reservation, and exact provider model/request/token usage to settle. A network timeout, unpriceable response, or unsettled usage holds the reservation and blocks further AI for that lead; it never automatically retries through another subscription. App setup now tells the user that the paid API is separate from Claude Code and reports only whether an API key is present, never its value. Added migration 3 for a verified Sonnet 5.5 price sourced from Anthropic’s current price page. Migration 1 and 2 were not edited.

Verified: `npm test` = 225 passing; `npm run typecheck`; `npx next build --webpack`; targeted ESLint; `git diff --check`. Fake-response tests cover exact input/output/cache-read billing, provider failure holds, integration-review gating, and no dispatch without billing context. Disposable browser and billing smoke tests could not start local listeners in this run (`EPERM`); their prior passing results are recorded above. No live Anthropic request, payment, Apify run, Instagram action or real campaign worker ran. The production `billing_integration_ack` remains unset. The current app has no observed Anthropic API key, so real AI drafting remains disconnected. Independent review of metering and restart behavior is required before the marker can be set. Do not start the worker while the existing active campaign and approval queue are present.

### Apify per-run cost protection (Codex, 2026-10-22)

Lead search now uses the Apify v2 Actor Run API rather than the dataset-only synchronous endpoint. It records a fresh authoritative account usage observation, reserves each search term against the payer’s ceiling and saved monthly cap, and passes that reservation as `maxTotalChargeUsd` to the vendor. The run ID is stored immediately in migration 4. The worker waits for a terminal run and for Apify’s usage total to stabilize, then records the exact per-run USD amount. If the run is still active, usage is missing, or the start outcome is unknown, it keeps the hold and reconciles by the saved run ID on retry; it will not launch the same operation twice. The API credential is sent in an Authorization header and never appears in the request URL.

Verified: fake Apify fixtures cover exact cost settlement, the monthly cap cutoff, payer/review requirements, mismatched billing-cycle rejection, retry with a saved run ID, and an unknown start without a run ID. The latest full suite is 228 passing; typecheck and Webpack production build pass, as do targeted ESLint and `git diff --check`. The UI and billing smoke runners remain blocked here because the sandbox rejects local listener creation (`EPERM`). No live Apify call or charge occurred. The real account usage cycle, actor input/output fields, actual run cap behavior, and per-run usage response are still unverified against the owner’s Apify account. Official API references: [Run Actor](https://docs.apify.com/api/v2/actors-runs-post), [Get Actor run](https://docs.apify.com/api/v2/actor-run-get), [Get account limits](https://docs.apify.com/api/v2/users-me-limits-get).

### Full no-spend verification update (Codex, 2026-10-22)

Rechecked the current branch after the Apify changes. `git pull --ff-only` could not reach GitHub because DNS lookup for `github.com` failed. `npm test` passes (228), `npm run typecheck` passes, and `npx next build --webpack` passes. The full disposable UI smoke, fake-processor billing smoke, and production auth/protected-route smoke all pass after allowing temporary loopback servers. They use throwaway databases; billing uses a local fake processor. No real provider, payment, worker or outreach action ran.

The local app was already listening on port 3100; a duplicate launch exited because that server was present. Browser inspection confirmed the Accounts page loads and shows three saved Instagram accounts, each with sign-in still unconfirmed. No worker was started. The app's actual live Instagram session, read-only profile/inbox behavior, real Anthropic generation, Apify, Stripe TEST and live worker are still unverified. No spend or Instagram action occurred. The worker must remain stopped while an active campaign and approval queue exist.

Owner next step: open one account's sign-in window from Accounts and sign in by hand; do not send credentials in chat. After that, verify session presence without exposing the cookie value and run only the read-only Instagram checks. Real AI generation remains off because it uses the separately metered Anthropic API; Claude Code quota is not a substitute. Apify and payment calls remain off under the no-spend request.

### Instagram sign-in browser isolation (Codex, 2026-10-22)

The Accounts page's History showed the earlier failure `Your existing Chrome session replaced the Instagram sign-in window.` The driver was explicitly launching the owner's installed Chrome channel, so login now uses the already-installed bundled Playwright Chromium with the account's own persistent profile directory. A focused test checks the headed profile launch and absence of a Chrome channel option.

Verified: focused test, 229 unit tests, typecheck, isolated Webpack production build, full disposable UI smoke, and diff check pass. The full UI smoke uses temporary data; no worker or Instagram action runs there. No spend occurred.

Still unverified: actual login-window launch and session persistence. Attempting the Accounts action from the current in-app browser did not visibly update its status or show a new Chromium window, so that interaction does not prove the changed launcher ran. The existing app server/browser state may be stale. Ask the owner to click Open login window in Accounts and sign in by hand if it appears; if it does not, capture the page's exact feedback and investigate the live server/action boundary. Do not start the general worker.

### Login window launched; manual CAPTCHA handoff (Codex, 2026-10-22)

Restarted the local Next dev server at `127.0.0.1:3100`, matching the browser origin. This restored visible app-action feedback. Clicking Open login window for the first saved account showed “Opening sign-in window” and “Instagram is opening in a separate window.” The separate Google Chrome for Testing window opened at `instagram.com/`, confirming the isolated Playwright Chromium launch works.

Instagram is presenting a CAPTCHA. Chrome also shows a password-save prompt. The owner must complete the CAPTCHA and sign in by hand, and decide on the browser's password prompt. No credentials were typed or read by Codex, no CAPTCHA was solved, and the prompt was left untouched. No like, comment, follow, message, worker campaign, paid API, Apify or payment ran.

Still unverified: authenticated session result, read-only profile and inbox steps, AI generation, Apify, Stripe TEST and campaign worker. After the owner finishes sign-in, refresh Accounts to confirm status; then run only the read-only Instagram checks. Keep the general worker stopped.

### Live routes and full no-spend browser check (Codex, 2026-10-22)

The app's live browser rendered the Overview, Campaigns, Lead progress, Review messages, Replies, History, Usage and billing, Settings, Accounts, and campaign-detail routes. Read-only runtime state shows the background service waiting with a heartbeat last seen about five hours ago and one failed task; campaign 4 is active but has no leads; 23 drafts await approval across the workspace; the Replies page has one existing reply. Accounts has three saved profiles, none confirmed signed in. Settings reports Anthropic not connected and Apify not set up; billing records $0.00 and the spending ceiling is $0, so paid work remains off.

Verified this turn: `npm test` = 229 passing; `npm run typecheck`; `npx next build --webpack`; full `UI_SMOKE_SCREENSHOTS=0 npm run smoke:ui` passes against disposable local data and verifies setup/login, campaign creation, leads, approvals, account controls, settings, DNC, team, permissions, responsive layouts, and worker heartbeat states. The smoke used local socket access after the restricted run was denied. No worker, Instagram operation, paid provider, payment, or message send ran.

Still not verified: successful hand sign-in and session persistence, read-only live Instagram profile/inbox, worker campaign execution, real Anthropic, Apify, or Stripe TEST. The login-only Instagram window was left for owner handoff at the CAPTCHA/password-manager prompt. Do not start general campaign processing while an active campaign or unreviewed work exists; do not run external/paid checks under the no-spend instruction.

Needs from owner: finish Instagram's CAPTCHA and hand sign-in in the open account window, then tell Codex. Codex can then confirm only session presence and try read-only profile/inbox. No password or token should be sent in chat.

### Logged-out public-profile guard (Codex, 2026-10-22)

The Instagram driver previously recognized logouts only from `/accounts/login` URLs. Instagram can instead overlay a login prompt on a public profile URL; profile reads then received the popup text and could give a misleading generic result. The driver now checks the visible page text for specific login-gate phrases as well as the URL and stops with the existing not-logged-in error before extracting profile notes or facts. Ordinary page text that only says “Log in · Sign up” does not trigger the guard.

Verified: focused parser and mocked-driver regression tests; `npm test` = 230 passing; `npm run typecheck`; `npx next build --webpack`; targeted ESLint; `git diff --check`. No Instagram page was accessed by this fix; no worker, social write, paid API, Apify run, payment, or message ran.

Still unverified: current Instagram login/session, live profile and inbox reads, and the actual text/layout Instagram displays for the login overlay. The owner must complete sign-in by hand before live read-only checks. Paid services remain off under the no-spend instruction.

### Local recovery and no-spend verification (Codex, 2026-10-22)

The local app had stopped, so the existing `127.0.0.1:3100` address was unavailable. Restarted the Next development server at that address; the Accounts route responds and redirects to login as expected. The user's existing Google Chrome profile was opened to Instagram, which showed the login screen and the owner's email as a saved passkey option. No passkey, password, or CAPTCHA was used.

Fresh checks passed: 230 unit tests, typecheck, Webpack production build, the disposable UI browser smoke, fake-processor billing smoke, and production authentication/protected-route smoke. The three browser/server smokes used disposable data; the billing smoke used a local simulator. No worker, live Instagram action, Anthropic, Apify, Stripe, or payment ran, and no money was spent. `git pull --ff-only` could not reach GitHub because DNS could not resolve `github.com`.

Still unverified: Instagram login/session persistence, live read-only profile/inbox, live worker execution, and real provider/payment integrations. The general worker remains stopped because the owner's workspace has an active campaign and pending drafts; starting it could trigger outreach. The app is available locally; the owner may need to refresh the existing browser tab. Next: owner completes Instagram sign-in manually in the open Chrome tab, then Codex checks only session presence and read-only profile/inbox behavior.

Correction (Codex, 2026-10-22): the first Chrome window was the wrong Google profile (`rudravejpara03012008@gmail.com`) and its Instagram page showed login. Switched to the specifically requested `rudravejpara099@gmail.com` (`Rudra099`) profile; Instagram was already signed in there. Its inbox and own profile loaded in read-only checks. This does not authenticate the app's separate per-account Playwright profile. That profile still needs its own sign-in unless the owner explicitly changes the locked profile-isolation design. No cookie/session was copied. Worker and paid integrations remain off.

Read-only app-side confirmation (Codex, 2026-10-22): queried only the status and boolean authentication outcome of the ten newest `open_login` records in the configured local database. All ten were `authenticated=false`; no cookie values were queried. Therefore, the successful Chrome login must not be treated as an app connection. The browser architecture change remains pending the owner's explicit confirmation.

### Local app and connection recheck (Codex, 2026-10-22)

The local app server is listening on `127.0.0.1:3100`; `/accounts` correctly redirects to `/login`, and the sign-in page renders in the browser. Fresh checks: `npm test` = 230 passing and `npm run typecheck` passes. A fresh disposable UI-smoke attempt could not start because `tsx` was denied permission to create a temporary IPC socket (`EPERM`), including when pointed at `/private/tmp`; the full UI smoke, billing simulator, production auth smoke, and Webpack build passed on this unchanged branch in #51.

No source code, owner data, browser permissions, worker activity, provider calls, payment, or Instagram action changed. The authenticated Accounts page and app-side Instagram session remain unverified. Reusing the owner's signed-in Chrome would require enabling Chrome's remote-debugging permission, which allows apps to read browser data and control pages; this setting remains off pending the owner's explicit choice. The alternative is hand sign-in in the app's separate browser profile, where Instagram previously presented a CAPTCHA. No credentials should be sent in chat.

### Signed-in Chrome access approved and confirmed (Codex, 2026-10-22)

The owner explicitly approved using the signed-in Chrome profile and allowed Chrome's remote-debugging consent dialog. Read-only browser inspection confirms Instagram is signed in: the profile page shows owner controls such as Edit Profile, and an Instagram Messages tab is already open. No message thread was opened and no private message content was inspected; no session cookie was copied or exposed.

This confirms that the owner's Chrome session works. It does **not** connect the app's current per-account Playwright profile: that remains a separate browser context, and raw Playwright CDP was rejected by Chrome. Chrome's documented `--autoConnect` route is through the Chrome DevTools MCP bridge and requires a consent dialog for each new debugging session. That bridge is an agent debugging interface, not an existing app integration. Do not claim the app is connected until its driver can use an approved integration and passes read-only app-side checks.

No code, account data, worker activity, paid call, payment, or Instagram write changed. Keep the campaign worker stopped and paid work off. Next: assess a supported local app integration for the approved Chrome connection without copying session credentials; until then, the app-side Instagram session is unverified.

### Chrome DevTools bridge proof and app integration gap (Codex, 2026-10-22)

The owner authorized the existing signed-in Chrome profile. The official Chrome DevTools MCP 1.11.0 bridge successfully connected after Chrome's per-session Allow prompt. Its read-only tools confirmed the Instagram profile page is authenticated and the Instagram Messages route is loaded; only URL/title/readiness and an authenticated boolean were returned for the inbox/profile check. The MCP process was stopped and the temporary package was removed from project dependencies after the experiment.

This proves an approved bridge can reach the owner's Chrome. It does not make the current app use that bridge: the app still launches its own Playwright profile, and the Chrome MCP server is a separate process that currently has no app adapter. Direct Playwright CDP remains rejected by Chrome. A real connection needs an app-owned adapter plus account identity matching and serialized browser access; it must not inspect unrelated Chrome tabs or expose session data. Do not start the campaign worker or perform social writes while implementing/testing this.

The attempt to open Instagram's Options menu for the app's "About this account" country read was rejected by automatic review because its element target was in a truncated accessibility snapshot. No alternate UI path was used. That specific live selector check remains unverified. No money or Instagram write occurred.

### Local production browser checks and Chrome connection boundary (Codex, 2026-10-22)

The smoke scripts now use isolated temporary Next build directories and production-start servers rather than a dev server that exhausted file watchers. This prevents smoke runs from overwriting the app's ordinary `.next` output. The UI contrast smoke calculation now accepts CSS `#rgb` and `#rrggbb` values and waits for approval-page content after navigation. The billing smoke test uses its fake payment provider only on loopback under explicit `OUTREACH_SMOKE_MODE=1`; normal production continues to reject local payment endpoints.

Verified fresh: `npm test` (230 tests), `npm run typecheck`, UI smoke, local fake billing smoke, and production authentication/protected-route smoke. All browser runs use disposable data. No worker, real payment provider, AI, Apify, or Instagram write ran; no spend occurred.

Instagram is authenticated in the user's approved Chrome profile `Rudra099`, verified through read-only profile UI. The local app does not connect to that browser: it currently uses isolated Playwright profiles, and Chrome's official DevTools MCP bridge is only available to the agent, not an app-owned adapter. No localhost DevTools endpoint is exposed, and no cookies/passwords/session data were copied. App-side Instagram connection and read-only profile/inbox via the app remain unverified. The live Options/About selector attempt was rejected by automatic review from a truncated accessibility snapshot; no alternate click path was used.

Next engineering task: design and implement an account-scoped adapter that can use the approved Chrome session without exposing session credentials or accessing unrelated tabs, then verify profile and inbox reads only. Keep the worker stopped and all paid/outbound actions disabled until the owner explicitly confirms any live outreach test.

### App-side Chrome bridge proof and ownership gate (Codex, 2026-10-22)

The user's `Rudra099` Chrome profile remains signed into Instagram as `timelessmoments.al`. A local probe using the official `chrome-devtools-mcp` server and MCP SDK matched only that Instagram profile tab and returned `{handle, URL, readyState, authenticated: true}`. No message contents or cookie values were read. The Chrome prompt grants an external app broad control of the profile; the owner explicitly approved the connection. Each new bridge process prompts again. The native debug endpoint at `127.0.0.1:9222/json/version` returns 404, so standard Playwright CDP cannot use it.

No application driver or worker is connected yet. The board assigns `worker/`, `lib/services/`, and `lib/db/repos/` to Claude and requires ACK before cross-owner edits. Codex posted request #58 proposing an opt-in account browser mode, a persistent official MCP bridge, read-only profile/inbox verification first, and a migration 5 claim. Wait for ACK before modifying those protected paths. Do not store or log browser session data. Keep the worker stopped and all likes, comments, follows, messages and paid services off.

Fresh current checks after installing the bridge dependencies: `npm test` = 230 passing, `npm run typecheck` passed, `git diff --check` passed. Earlier this turn, before the dependency experiment, isolated UI smoke, local billing simulator smoke and production authentication/protected-route smoke all passed. These establish local app flows; they do not prove live app-to-Instagram integration.

Dependency reason: `chrome-devtools-mcp` is Google's official bridge for a consented signed-in Chrome profile, and `@modelcontextprotocol/sdk` is needed for the local app to call that bridge. `npm audit --omit=dev` reported 0 vulnerabilities after installation. No real paid API, payment, worker action, or outbound Instagram operation ran; no money was spent.

### Bridge dependency revalidation (Codex, 2026-10-22)

Kept the official Chrome DevTools MCP and SDK dependencies present while validating the next integration step. Fresh checks: 230 tests and typecheck pass. `npx next build --webpack` passes. The default `npx next build` failed twice in Turbopack while creating/binding a local helper process (`Operation not permitted`), including an elevated retry. This is an environment/build-path failure; it does not establish a code compilation failure.

No app-owned adapter has been implemented yet, so do not claim Instagram is connected to the app. The worker/repository integration and migration remain behind Claude's unanswered ACK request #58. No worker, Instagram write, paid provider, payment, or spend occurred.

### Owner authorization to implement the Chrome connection (Codex, 2026-10-22)

The owner authorized Codex to proceed without waiting for Claude's response to board request #58. Migration ids 1 through 4 already exist, so the next migration is 5. Planned mode is opt-in `chrome_read_only`, with existing `isolated` behavior remaining the default for other accounts. The app will use the official Chrome DevTools MCP package with a strict Instagram URL allow-list, bind to the exact saved account handle, verify auth using only page UI signals, and reject warm-up/send actions in this mode.

The approved signed-in Chrome session was inspected locally. A Chrome DevTools MCP process can connect to it using the actual Chrome user-data directory and an Instagram-only URL allow-list, after the previously approved Chrome remote-debugging prompt. The first app-level probe found the account tab but its initial auth predicate was too narrow; it searched button elements only. Improve that predicate using accessible page UI and verify it on the live profile before claiming connected. No private inbox content, cookies, passwords, social write, worker campaign or paid provider call was used.

### Signed-in Chrome account mode implementation update (Codex, 2026-10-22)

Implemented migration 5 with an opt-in `chrome_read_only` account mode; existing accounts and new accounts default to `isolated`. The Accounts page now offers the signed-in Chrome option and a way to switch back. The official Chrome DevTools MCP adapter uses the signed-in profile with an Instagram-only URL allow-list. The worker defers all campaign jobs for Chrome-mode accounts, including Apify lead search when every campaign account is read-only. No likes, comments, follows, sends, AI drafts, or inbox reads are enabled in this mode.

Validation: 235 tests pass, `npm run typecheck` passes, `npx next build --webpack` passes, and `git diff --check` passes. The default Turbopack build has previously failed in this restricted environment while binding a helper process. The UI smoke could not start in this turn because the sandbox denied tsx's temporary IPC socket; prior isolated browser and billing smokes passed before these changes. A live app-side Chrome sign-in check did not succeed: Chrome shows the owner signed in, but the adapter returned false / could not resolve the profile tab during probes. Therefore the app is not verified as connected, and the Chrome mode must be treated as sign-in-check-only and unusable for campaigns until that defect is fixed. No paid API, Apify call, payment, or outbound Instagram action ran; no money was spent.

Next: inspect the official bridge's live `list_pages` and `evaluate_script` result shapes without printing page content, fix the app-side authenticated signal, then verify through Accounts in the actual running app. Preserve the isolated mode default and the hard worker guard. Keep all worker campaign work, paid providers, and Instagram writes off until separately confirmed.

### Chrome sign-in bridge retry and no-spend reliability checks (Codex, 2026-10-22)

Changed: removed the unsupported explicit Chrome profile-path argument and added the exact Instagram apex host alongside `www.instagram.com` in the allow-list. Chrome errors now become plain, non-secret next-step messages; an MCP tool error is surfaced instead of being treated as an empty page list. Added tests for exact HTTPS Instagram hosts, bridge arguments, and safe failure text. Also changed one lint-only `let` to `const`.

Verified: 237 tests, typecheck, lint, webpack production build, UI smoke, fake local billing smoke, and production authentication/protected-route smoke passed. The latter three browser runs use disposable data; billing uses only the local fake processor. The approved official Chrome bridge enumerated the signed-in Instagram profile page after the owner's session approval. A fresh app-driver sign-in attempt still did not return, so the product is not yet verified connected. No private inbox content, cookie/password values, paid provider, live payment, worker campaign, or Instagram write was used; no money was spent.

NOT verified: successful app-side Chrome sign-in check, read-only app profile/inbox reads, worker campaign execution, or live AI/Apify/Stripe connectivity. The live app login screen is not authenticated in this browser, and the local server was unavailable during the final smoke check.

Next: fix and test the product's Chrome bridge call/response lifecycle, then verify the signed-in status through Accounts and the read-only app profile flow. Keep the worker stopped and do not perform social writes or paid calls.

### Product-level Chrome sign-in job verified (Codex, 2026-10-22)

Verified: the actual `AccountInstagramDriver` and `open_login` job script ran against a disposable SQLite database, used account mode `chrome_read_only`, and completed with `authenticated: true` for the exact saved handle `timelessmoments.al`. This is stronger than the standalone bridge probe: the app code selected the account-specific Chrome driver and wrote the job result. The test read only the profile page's signed-in indicator. No real app database was modified; no inbox text, cookies, passwords, campaign jobs, social writes, or paid APIs were used; no money was spent.

Environment detail: sandboxed Node processes cannot read Chrome's `DevToolsActivePort`; the same app job succeeds when run with the user's approved local Chrome access. This is a local-machine permission boundary, not a missing Instagram login. The production Next server is running on `127.0.0.1:3100` for owner sign-in. Browser automation policy blocked the agent from opening the localhost Accounts page, so the visible app UI confirmation still needs the owner to sign in and view Accounts.

Still unverified: owner-authenticated Accounts page status, read-only profile/inbox operations through the product, and live campaign execution. The Chrome mode intentionally refuses campaign work; no warm-up or message send was run. Paid API, Apify, and Stripe connections remain untested.

Next: owner signs into the local app at `http://127.0.0.1:3100/login`, opens Accounts, and confirms the connected indicator. Then continue with read-only product checks only. Do not run campaign sends or paid calls without separate approval.

### Chrome bridge reliability follow-up

The app-owned read-only Chrome adapter now bounds MCP initialization and tool calls at 30 seconds, closes the helper transport if initialization fails, and treats MCP tool errors or missing/malformed sign-in results as failed checks rather than completed jobs with `authenticated: false`. A genuine `loggedIn: false` result still records a completed, unauthenticated check. Full `npm test` passes (239 tests), `npm run typecheck` passes, and `git diff --check` passes. This is not a new live Instagram verification: signed-in Chrome, product-side profile/inbox checks, worker execution, and paid integrations remain unverified.

### Live app account sign-in verified (Codex, 2026-10-22)

Changed the saved Instagram account to the approved `chrome_read_only` mode after confirming it had no active campaign or queued work. The real app-owned `open_login` job then completed with `authenticated: true` for the exact saved profile in the user's approved Chrome profile. The check read only the exact profile page's UI signal and warning state; it did not open/read the inbox, start the worker, or perform any social action. No money was spent.

The connection is now verified for sign-in only. Chrome mode still blocks all campaign jobs; profile-fact qualification and inbox sync are not enabled through this adapter. The separate isolated sign-in path remains unverified. AI, Apify, and Stripe credentials are absent from the local environment, so real provider flows remain untested and must not be called under the no-spend instruction.

Whole-app no-spend checks: `npm test` = 241 passing, `npm run typecheck`, `npm run lint`, and `npx next build --webpack` pass. The disposable UI and billing simulator smokes also passed: setup/login, campaign/lead/approval/account/settings/auth routes and layouts; and fake checkout, webhook replay, fee reconciliation, exports and user isolation. These prove local test flows only, not real Instagram reads, provider APIs, campaign execution, or payment processing.

### Chrome sign-in tab identity guard

The app-owned read-only Chrome sign-in check now revalidates the live page inside the evaluated script before reading any body text. It requires HTTPS, an exact Instagram host, and the exact saved account profile path; a redirect or changed tab returns no page text and fails the check rather than reading another page. The handle is validated before it is embedded in the script. Focused browser-mode/login-job tests (12) and `npm run typecheck` pass. This is a local regression check only: a fresh live Chrome run, profile facts, and inbox reading remain unverified. Chrome mode still permits only the sign-in check; no worker, social write, or paid call ran.

### Chrome read-only profile and reply checks (Codex, 2026-10-22)

Changed: extended the explicitly selected `chrome_read_only` account mode to support public-profile qualification and inbox reply synchronization. Both paths first verify the saved account's exact Instagram profile in the approved Chrome session. Page scripts check Instagram host, exact profile/inbox/thread path, owner identity, and warning/login state before returning page text. Inbox sync is bounded to the 15 most recent threads and incoming messages only. Warm-up, AI drafting, sending, lead search through a Chrome-only campaign, and all paid services remain disabled.

Verified locally: `npm test` = 247 passing; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; `git diff --check`. No live profile facts or inbox content were read in this turn; no worker, social action, paid API, or payment ran. The earlier app-owned sign-in check remains the only live Instagram verification.

NOT verified: live profile qualification, inbox sync, campaign execution, or live AI/Apify/Stripe connections. These are code-path checks only. Keep the worker stopped and do not claim outreach execution is live-ready.

### Short whole-app verification (Codex, 2026-10-22)

Verified in this turn: 247 unit/integration tests, typecheck, lint, Webpack production build; disposable Playwright UI smoke passed setup, login, campaign creation, leads, approvals, settings, responsive/theme/accessibility basics, authenticated routes, caps/pause/resume and fake worker heartbeat checks. Disposable billing simulator passed checkout, signed/replayed webhooks, exact fee reconciliation, exports and user isolation. Production security smoke passed unsafe-secret refusal, setup/login, protected routes, sign-out and signed-out redirects. These checks use temporary app data and a fake payment provider; no real payment or paid API was called.

Live local state: the saved Chrome account has a completed sign-in check, but its adapter is read-only. Active campaign #4 is approval-required and assigned to a different account that is paused; there are no queued or running jobs. One app-adapter public-profile qualification attempt timed out before returning facts. No inbox was opened, worker started, or social action performed.

Provider setup: local environment has no Apify, Anthropic, or Stripe credentials, no Stripe owner/test-webhook configuration, and no hosted database configuration. Real lead search, paid AI writing, test checkout with Stripe, campaign execution, and durable hosted operation remain unverified. Do not mark the app fully operational yet.

Next work needs: (1) privately configure the owner-approved provider keys, starting with the exact integrations needed for the demo; (2) choose/authorize the Instagram write-capable connection approach—the existing connected Chrome mode cannot send and the isolated browser account is paused/unverified; (3) explicitly approve one single test DM with campaign approval ON before any live send test. No money was spent in this verification.

### Chrome profile loading follow-up (Codex, 2026-10-22)

The live public-profile check now passes its saved-owner verification and opens the exact target profile, but Chrome showed Instagram's loading screen and the follower count was unavailable. Added a six-second bounded wait for the profile header and expected profile content before parsing facts; exact host/path validation and warning/sign-in checks remain in place. Added a regression assertion for the bound. The live profile was not read successfully, no inbox was opened, and no worker, social action, or paid call ran. 251 tests, typecheck, lint, and Webpack production build pass. Profile facts, inbox sync, paid provider connections, and campaign execution remain unverified.

### Live workspace readiness recheck (Codex, 2026-10-22)

Read-only inspection of the app currently open at `127.0.0.1:3100` and its configured SQLite database found: the background worker is stopped; active campaign #4 has approval ON, zero leads, and only paused isolated account #1 assigned; account #2's sign-in is confirmed but its `chrome_read_only` mode cannot run campaigns; account #3 is active isolated but its last login job does not confirm sign-in. There are 23 messages pending approval, 105 already sent, and no queued or running jobs. No inbox content was read. Starting the worker would not make campaign #4 ready and was not done.

An independent provider setup review found no Apify, Anthropic, or Stripe test credentials configured. Missing configuration prevents live provider checks; no provider calls or charges are authorized. The running local app is served from the separate `main` checkout at `f03ffe2`, while the fixes on this branch are committed through `dacbe81`; changes on this branch are not reflected in the running app. Remaining owner steps for a live demo: sign in through a campaign-capable isolated account and assign it to the campaign (or choose/approve a supported sending design); privately configure needed test/provider credentials, then explicitly authorize any paid provider call and a recipient-specific test DM. No money was spent.

### Campaign sender readiness feedback (Codex, 2026-10-22)

Changed: an active campaign now explains when its selected Instagram accounts cannot run campaign work, naming paused, blocked, and Chrome read-only senders and pointing to account selection. If another active campaign-capable account exists, it names that account as available but not selected. This avoids showing an active campaign as ready when no sender can run it.

Verified: 251 tests, typecheck, lint, and Webpack production build pass. The UI smoke passed immediately before this final copy refinement; no live send, inbox access, paid provider call, or payment ran.

### Chrome connection timeout follow-up (Codex, 2026-10-22)

Live diagnostic: the app adapter's public-profile read timed out, and the official Chrome bridge's read-only page inventory also timed out. A local probe of `127.0.0.1:9222/json/version` did not receive a response. The earlier saved-account `open_login` job is still recorded as successful, but Chrome remote debugging is currently unreachable; current app-side profile qualification cannot be verified. No Chrome page contents were read during this diagnostic, no browser restart or profile change was performed, and no inbox, worker, social action, or provider call ran.

Owner step when ready: open Chrome's `chrome://inspect/#remote-debugging` in the already signed-in profile and ensure remote debugging is enabled for this browser instance. Then the app can retry the exact account check. This does not authorize sending.

### Chrome read-only profile check reached identity guard (Codex, 2026-10-22)

Chrome's remote-debugging permission prompt was accepted under the owner's prior session approval; `chrome://inspect/#remote-debugging` shows the setting enabled. The product's `readFacts` flow then stopped at its fail-closed account-identity guard with "The saved Instagram account could not be confirmed before reading this profile." It returned no profile facts. This could mean the target page does not expose a link to the owner's profile, or that the page/result identity did not match; do not weaken the guard without reviewing the exact identity proof. No inbox was read, no worker or campaign ran, and no social write or paid call occurred.

Next: request backend-owner ACK in COLLAB before changing `worker/` profile identity logic. Keep all sends off.

### Signed-in Chrome connection restored (Codex, 2026-10-22)

Changed: the Chrome read-only adapter now passes the platform's explicit Chrome user-data directory to Chrome DevTools MCP `--auto-connect`. The adapter previously relied on implicit profile discovery, which failed on this machine even after remote debugging was enabled. Added a regression assertion for the explicit profile argument. The collaboration board entry #77 now includes the reproduction and narrow-fix evidence.

Verified: the exact app adapter check returned signed-in for the saved Instagram account; the Accounts page then showed “Instagram is connected.” Read-only only: no inbox/profile facts, likes, follows, comments, or messages were accessed or sent. `npm test` = 251 passed; `npm run typecheck`, targeted ESLint, disposable `npm run smoke:ui`, `npx next build --webpack`, and `git diff --check` pass. No paid provider or payment call ran; no money was spent.

Still unverified: campaign-capable isolated Instagram sign-in and sending; Chrome read-only profile facts/inbox; worker start/stop control and campaign execution; live Anthropic, Apify, and Stripe TEST integrations (credentials are not configured). The connected account remains Chrome read-only, so campaign actions are intentionally disabled for it. The fix is committed as `d07c4ce` on `fix/first-run-operability` and pushed to open PR #13; do not claim the full SaaS is production-ready from these checks alone.

### Public Instagram profile qualification restored (Codex, 2026-10-22)

The first public target (`levivdwaarden`) was age restricted in the approved signed-in Chrome profile, so Instagram supplied no follower or relationship facts. A second, unrestricted public target exposed a selector bug: the Options label was on an SVG, which has no `.click()` method. The read-only script now clicks its interactive ancestor and reports age-restricted profiles as unavailable. Fake-DOM tests cover both cases. A live call through `ChromeReadOnlyInstagram.readFacts` verified the saved owner and returned public profile facts for `instagram` (`isPublic: true`, follower count, relationship, country unavailable). No inbox, worker campaign job, social write, paid provider, or payment ran.

Checks for this change: 253 tests, typecheck, changed-file ESLint, Webpack production build, and diff check pass. The disposable UI smoke and fake billing smoke passed before this read-only worker change and were not repeated because their paths were unchanged.

Chrome displayed its existing remote-debugging consent prompt for each new diagnostic process. The long-running worker caches a Chrome connection per account, but its end-to-end lifecycle is not yet verified. The current connected account remains `chrome_read_only` and cannot run campaigns. Account #3 is isolated and active but has no verified sign-in; active approval-required campaign #4 is assigned only to paused account #1. The remaining live product path requires a campaign-capable account sign-in, provider test configuration and approved no-spend test boundaries before any paid call or recipient-specific send. Do not claim campaign execution, inbox sync, or paid integrations verified from this profile check.

### First-reply handoff and signed-in Chrome read-only follow-up (Codex, 2026-10-22)

The product boundary remains the prospect's **first real DM reply**. `handleIncoming` now records and counts that reply once, cancels follow-ups, and logs one handoff. Repeated inbox polling and later messages do not create another handoff or app-written reply; automatic responses remain ignored until a real reply arrives. Repository tests cover replay, automatic responses, and a lead stopped after handoff.

The signed-in Chrome inbox reader now uses Instagram's actual conversation controls (excluding the account's own note), opens at most 15 threads through UI navigation, and looks only at incoming message articles. It checks the saved account, exact Instagram URLs and warning state before reading. A loading conversation now fails explicitly instead of reporting zero replies. Live read-only testing was approved by the owner for this session and reported only a success flag/count: navigation reached the conversation list, but Instagram left the conversation pane on a loading spinner; reply extraction and database sync are **not verified**. No private message text was put in the diagnostic output. The Chrome account remains read-only; no worker, campaign job, like, comment, follow, send, or paid call ran.

Public `readFacts` now waits for the About dialog and handles one already open. A live app-driver call verified the saved owner and returned public status, follower availability, relationship availability and `country: United States` for the public `instagram` profile. This confirms public fact extraction only; it does not verify qualification for a campaign or any outreach action.

Next: retry the read-only inbox check after the conversation pane loads normally, then verify one controlled incoming-reply sync against disposable app data. Campaign execution still needs a verified campaign-capable Instagram account and separately approved provider/test-send steps. Keep approval ON and the worker stopped until the remaining gates are met.

### Live first-reply check through disposable app data (Codex, 2026-10-22)

Chrome's Instagram conversation pane remained on a spinner and the browser logged a stream-establishment error. A normal reload of that already signed-in conversation restored its visible message articles. The approved app-level `ChromeReadOnlyInstagram.readInbox` then returned **one incoming reply** from the bounded inbox check, reporting only the count. A second run fed that returned reply directly into `handleIncoming` using `openDb(":memory:")` and a disposable `dm_sent` lead: the first call counted the reply, changed the lead to `replied`, and cleared its follow-up; replaying it did not count or hand off again. The temporary database was closed without writing the owner's app database. No private message text or partner handle was printed in diagnostics.

The same returned reply was also processed through one real `runOne` `check_inbox` job with disposable app data and the real Chrome read-only driver. The job completed, stored one incoming message, changed the lead to `replied`, and cleared its follow-up. This verifies live read-only extraction and the actual worker job path against an in-memory database. It does **not** verify a long-running worker or durable reply sync in the owner's real database. The Instagram account remains `chrome_read_only`, so campaign sending is still disabled. No social write, paid provider call, or payment ran; no money was spent.

### First-reply boundary and local worker controls (Codex, 2026-10-22)

The first real incoming DM now moves a lead to `replied` even when it arrives before our first send or after being skipped. A queued approved DM or follow-up is not scheduled or sent once the lead has replied, and the worker rechecks stage, message approval, campaign, account, do-not-contact and daily limit after its send wait. Due inbox checks run before queued sends in each account lane; accounts with `dm_sent` leads keep receiving read-only inbox checks even when their campaign is paused. Automatic replies remain ignored as decided. A do-not-contact record stays in force after a skipped prospect writes. Tests cover early inbound, skipped inbound, queued work, a reply during the wait, paused-campaign inbox sync, and inbox ordering.

The dashboard now offers local Start and Stop controls for the background service. Start uses an atomic SQLite ownership lease to prevent two workers and refuses an active campaign without a selected, active campaign-capable account. Stop requests a graceful drain; new job claims are fenced by the same lease transaction, and a send rechecks Stop immediately before dispatch. The dashboard tells users that Start may process already-approved DMs. This control is disabled in hosted and UI-smoke runtimes. No real worker was started.

`npm test` passed 277 tests, `npm run typecheck`, changed-file ESLint, `npx next build --webpack`, and `git diff --check` passed. The isolated `npm run smoke:ui` check also passed after updating its expected worker status labels. It uses a temporary database and local test browser; no external calls or social actions ran. A separate local server is reachable on port 3100, but its signed-in dashboard was not available for visual review in the owner's Chrome profile. Start/Stop against the owner's database and live campaign execution remain unverified. The signed-in Chrome account is read-only and cannot send; connect and verify an isolated campaign-capable account before any approved live campaign run. Provider-paid and social-write checks still require the owner's separate approval.

### Current no-spend verification (Codex, 2026-10-22)

Verified on the current `fix/first-run-operability` checkout: `npm test` (277), `npm run typecheck`, `npm run lint`, `npx next build --webpack`, `npm run smoke:ui`, `npm run smoke:billing`, and `node --import tsx scripts/security-smoke.ts` all pass. The two smoke scripts use temporary app data and fake/local providers; the security smoke uses a temporary production database. No message was sent and no paid service was called. Read-only browser inspection confirmed the authenticated local app screens render. A bounded `PlaywrightInstagram.readProfileNotes` check through the active isolated campaign account returned profile content for a public Instagram profile; the temporary browser was closed afterward. No source code or owner database was changed during this check.

Current owner database, inspected read-only: campaign #4 is the only active campaign, approval is on, its selected sender is active, and the campaign has no leads. There are zero queued jobs and no approved messages; the 23 outbound drafts are pending approval. The older 104 `dm_sent` leads have no `campaign_id` or `account_id`, and their 105 sent-message records also have no sender account. These legacy records cannot be safely attributed to an Instagram inbox without a reliable historical sender mapping. Do not bulk assign them or start the worker based on these records. Four other campaigns are drafts and contain 73 leads.

Still not verified: adding a real lead to campaign #4, live qualification on that campaign, a long-running worker, durable reply sync against correctly attributed sent leads, any live DM, and real Anthropic/Apify/Stripe TEST calls. AI writing, Apify search, and Stripe credentials are not configured, and the owner's no-spend instruction remains in force. The worker remains stopped. A real test DM still requires the owner's explicit approval; paid provider calls require separate authorization.

Next: first determine which account sent the unassigned historical DMs, or start with a new test lead explicitly assigned to campaign #4. Then continue only through the approved no-spend/read-only path until the owner confirms a specific test send.

### Team-time-zone daily limits and counts (Codex, 2026-10-22)

The saved team IANA time zone now governs new accounts' warm-up start date, the worker's daily-cap check (including its final pre-send recheck), Accounts-page sent count, dashboard account counts, and dashboard daily/seven-day totals. User-facing counts no longer label the day as UTC. Calendar boundaries correctly cover daylight-saving 23- and 25-hour days; invalid dates/zones fail instead of silently miscounting.

Verified: `npm test` = 284 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; and `npm run smoke:ui` pass. A runner regression proves that a queued send waits when the local day is already at its cap even though UTC has passed midnight. The UI smoke uses a disposable database/browser and sent no messages. No worker, Instagram write, paid service or payment ran, and no owner database mutation occurred; no money was spent.

Still unverified: live campaign send/cap enforcement, paid provider integrations and durable reply sync. Campaign #4 still has no lead for a campaign qualification check. A real test DM needs the owner's explicit approval; paid calls remain off under the no-spend instruction.

### Queued-send campaign guard regression (Codex, 2026-10-22)

The worker already rechecks campaign status and sender assignment immediately before Instagram dispatch. Added regression tests proving an approved queued send remains unsent if the campaign is paused or its sender is removed during the final pacing wait. Updated `docs/FUNCTIONAL-AUDIT.md` to replace its stale claim that this guard was missing.

Verified: `npm test` = 286 passed; `npm run typecheck`, `npm run lint`, `npx next build --webpack`, and `git diff --check` pass. Test-only addition; no worker, Instagram action, provider, payment, or owner database was touched.

### Live local app check after refreshing the build (Codex, 2026-10-22)

The local app on `127.0.0.1:3100` was serving an older build. I gracefully restarted only the Next.js web server; the worker remained stopped. In the signed-in app, the refreshed Overview and Accounts pages render the team-local labels. Current UI shows 202 workspace leads, 23 messages awaiting approval, five failed background tasks, and a stopped worker. Active campaign #4 (“test 1 at 10:26PM 21OCT”) has zero leads; its page clearly says work waits for the background service and invites adding leads. Accounts shows `@rudravejpara03012008` active and connected, `@timelessmoments.al` active but Chrome read-only, and `@rudravejpara` paused. No settings, leads, approvals, or campaign state were changed during this check.

This confirms the local screens and saved state only. No live campaign job, real DM, paid provider, or payment was run. To test the campaign workflow, add a fresh lead to campaign #4; before any DM, the owner must explicitly approve that specific send. Keep the worker stopped until the test is intentionally authorized.

### Additional production-auth and billing simulation check (Codex, 2026-10-22)

Rechecked campaign #4 in the signed-in local app: still active with zero leads; no owner change since the prior snapshot. `node --import tsx scripts/security-smoke.ts` passed production setup/sign-in, protected routes, sign-out and signed-out redirects on disposable data. `npm run smoke:billing` passed its isolated checkout, signed/replayed webhook, reconciliation, export, user-isolation and responsive UI scenarios using only the local fake provider. Neither test started a worker or called Instagram, real Stripe, AI or Apify. Actual Stripe TEST remains unverified; the user's no-spend instruction remains in force.

### Close Instagram browser resources when the worker stops (Codex, 2026-10-22)

The worker now closes its account driver after active lanes drain and before it releases the worker lease. Driver shutdown closes all persistent isolated Playwright contexts as well as signed-in Chrome DevTools clients; repeated cleanup is safe, and cleanup errors do not prevent the remaining contexts from closing or the worker lease from being released. Regression tests cover the isolated context lifecycle and its inclusion in account-driver cleanup.

Verified: `npm test` = 288 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; `git diff --check`. No live browser was opened, worker was started, or Instagram action/provider/payment performed as part of these tests. Live worker shutdown with an open Instagram context remains unverified.

### Worker shutdown check against a disposable database (Codex, 2026-10-22)

Strengthened the browser cleanup regression to go through `AccountInstagramDriver`, close two persistent contexts, and confirm a failure in one context does not prevent cleanup of the other. Then started the actual worker process against a temporary empty SQLite database, sent SIGINT after its ready message, and verified it exited and wrote a stopped lease. No accounts, campaigns, jobs, or provider credentials were present in the fixture.

Verified: `npm test` = 287 passed; `npm run typecheck`, `npm run lint`, and `git diff --check`. This verifies an idle graceful stop and mocked context cleanup; it does not verify an open real Instagram browser during worker shutdown. No real integration or spend occurred.

### Full local verification refresh (Codex, 2026-10-22)

Re-ran the current branch checks: 287 tests passed, `npm run typecheck`, `npm run lint`, and `npx next build --webpack` passed. The isolated browser smoke passed setup, sign-in, campaign creation, lead import, campaign-scoped approvals, responsive/theme behavior, worker heartbeat states, settings, DNC, account checks, and related controls; it sent no messages. The billing simulator passed with fake payments and disposable data. Production sign-in/security smoke passed on a temporary database. No Instagram, Apify, AI, real Stripe, or worker campaign call ran, and no money was spent.

The signed-in local app still shows campaign #4 active with zero leads and the background service stopped. The application cannot verify that campaign's real prospect-to-first-reply path without a lead; continue with read-only qualification after a fresh lead is added, and require specific owner approval before any send. No campaign settings or owner data were changed during this refresh.

### Manual first-DM path and Chrome queue cleanup (Codex, 2026-10-22)

Added a no-cost manual first-message composer for warmed leads in active campaigns with approval ON. It requires three nonempty parts, limits each to 380 characters, and requires the configured campaign link exactly once in part 2. Creating it adds a pending-approval message; it never sends. The action rechecks ownership, campaign state, approval, lead stage, DNC, duplicate messages, and sender eligibility. Chrome worker planning now skips jobs that the selected account mode cannot run, preventing unsupported AI drafting/warm-up tasks from being repeatedly queued.

Verified: `npm test` = 296 passed; `npm run typecheck`; `npm run lint`; `git diff --check`; `npx next build --webpack`; `npm run smoke:ui`. The UI smoke used disposable local data and sent no messages. The owner's regular Chrome profile `Rudra099` is already signed in to Instagram as `@timelessmoments.al`; the Google Chrome for Testing window is unnecessary. No inbox message content was read during this browser check. No live DM, paid API, Apify, or payment call occurred; no money was spent.

NOT verified: a new lead's live qualification, manual message review/approval in the actual campaign, live send, inbox reply sync, or paid AI/Apify/Stripe. Campaign #4 has zero leads, approval ON, and worker stopped; 23 messages remain pending approval. Do not start the campaign or send a message for this verification. The saved `check_inbox` job remains deferred until the account's allowed work window.

Decisions made: use the owner's signed-in Chrome profile for campaign DMs, keep message approval ON, keep the worker stopped after lifecycle verification, and spend nothing on paid integrations without owner approval.
Needs from Rudra: add a suitable lead to campaign #4. For the first actual outbound test, review the composed message and explicitly confirm the send. Paid AI/Apify configuration is optional and only required if those paid features are desired.
Next I will: finish checks, update PR #13, and keep live messaging paused until the owner confirms the first send.

### Current campaign and integration readiness (Codex, 2026-10-22)

Rechecked the live local Accounts, campaign #4 settings, Pipeline, and Settings pages. `@rudravejpara03012008` is connected and selected for campaign #4; `@timelessmoments.al` is read-only and `@rudravejpara` is paused. Campaign #4 is active, approval-required is ON, and follow-ups are ON; it has zero leads and the worker is stopped. The separate Anthropic API connection and Apify connection are not configured; paid message writing and lead search remain paused, with no paid calls made.

The signed-in Chrome profile opened the public `@richcreditrepair` page read-only (17.4K followers, credit repair/funding content). The matching workspace lead is already assigned to “Sunil leads,” and the public page did not establish the campaign's required US location. It was not moved or changed. For a valid #4 workflow check, add a fresh suitable US prospect to that campaign; app-level qualification can then be checked read-only before any approval or outreach. No money or Instagram actions were used.

The product's own `ChromeReadOnlyInstagram.readFacts` was then exercised against that public profile with the saved read-only account and the owner database opened read-only. Chrome requested its remote-debugging consent, which the owner had previously approved for this session. That earlier attempt did not read or save profile facts: its `list_pages` call timed out, and a second check using the package's direct browser-URL mode could not connect. The later sign-in check below succeeded after allowing the task to connect to Chrome's local debugging socket. No inbox, message text, campaign record, or paid integration was accessed in those failed fact-reader calls.

### Signed-in Chrome campaign DMs (Codex, 2026-10-22)

Changed: the owner authorized campaign use of the existing signed-in Chrome profile with message approval ON. Active Chrome-mode accounts can now be selected as campaign senders, and the Chrome driver can send a DM only after the worker's existing approval, campaign/account/lead, do-not-contact, pacing, and daily-cap checks pass. The driver verifies the saved sender profile, opens the exact prospect profile, uses fresh Chrome accessibility snapshots and scoped input controls, and stops on Instagram warnings. If submission may have started but cannot be verified, it raises the existing uncertain-send error so the worker does not retry automatically. Signed-in Chrome still cannot like, comment, or follow; paid AI drafting and Apify search remain disabled under the no-spend rule. A human can approve/create messages through existing app workflows.

Verified: fake-MCP driver test exercises exact-owner verification, profile navigation, fresh control selection, message entry/submission, and empty-message rejection. Runner test exercises one already-approved Chrome-mode DM while approval remains required. `npm test` = 290 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; `git diff --check`. No live message was sent, no worker campaign was run, and no paid provider or payment was used.

NOT verified: the live Chrome input sequence against Instagram, live campaign send or reply handoff, lead availability, worker execution, AI drafting/Apify search, or external payment. On 2026-10-22, campaign #4 was updated in the app to select `@timelessmoments.al` instead of `@rudravejpara03012008`; approval remains ON. The current app has zero leads on that active campaign and the worker is stopped. No queued/running jobs were present. The AI API and Apify integrations are not configured; no paid calls were made. A real send still requires the existing human message approval and a separately confirmed test send.

Decisions made: the owner explicitly allowed campaign use in signed-in Chrome and required message approval to stay ON. Keep non-message social actions and paid services disabled until separately authorized. No migration was needed; existing persisted Chrome mode is retained for compatibility despite its historical `chrome_read_only` name.
Needs from Rudra: add a suitable lead to campaign #4 and explicitly confirm before the first live test DM. Configure paid AI or Apify only if you want those features enabled and approve their costs first.
Next I will: keep the worker stopped and the app available locally; do not send, like, follow, comment, or call paid services.

### Worker readiness for signed-in Chrome (Codex, 2026-10-22)

Changed: removed the worker-start restriction that required a separate isolated Instagram browser. The active campaign can now start with its selected signed-in Chrome account. A regression test covers allowing an active Chrome sender and refusing a paused sender.

Verified: rebuilt the production app and exercised the real local Start/Stop controls. Outreach moved from stopped to running and then back to stopped. Before start, the database had no queued/running jobs, no approved messages (23 were pending approval), and no leads in the active campaign. After the smoke check, the message counts were unchanged and no send occurred. One scheduled `check_inbox` job was queued by the worker and deferred until its allowed work window; worker is stopped. No paid integration or money was used. `npm test` = 290 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`.

NOT verified: actual live inbox read for that deferred job, campaign qualification and message generation for a fresh lead, or live send/reply. The Chrome path intentionally blocks warm-up likes/comments/follows; draft generation/search need separately configured paid providers, currently absent. Do not say the whole live prospect-to-reply workflow is 100% verified.

Needs from Rudra: add a suitable campaign lead; confirm any first live DM after reviewing its text. Paid AI/Apify configuration is only needed if those functions are wanted and their costs approved.
Next I will: leave worker stopped, no money spent, and no social write performed.

The campaign-capable isolated account's own profile was also opened through `PlaywrightInstagram`. Its browser showed Instagram's sign-in gate, and the old `looksLoggedOut` copy check missed this specific public-profile sign-up prompt, causing a 30-second wait for an Options control. Added that exact prompt to the pure logout detector and its parser test so future checks fail with the existing actionable sign-in message. That separate sign-in attempt was stopped after the owner identified it as the wrong Chrome window. Do not ask the owner to sign into that window again; use the later Chrome connection check below as current evidence.

### Current Chrome connection and no-spend check (Codex, 2026-10-22)

The owner's existing Rudra099 Chrome profile is signed into Instagram as `@timelessmoments.al`. The app's own `ChromeReadOnlyInstagram.openLogin` check returned `authenticated: true` for that exact saved handle after the owner-approved Chrome remote-debugging prompt. The first attempt was blocked by this task's sandbox from connecting to Chrome's local debugging socket; the same read-only app check succeeded when run with local connection permission. The output reported only the sign-in boolean. No inbox, profile facts, cookies, campaign jobs, or private message text were read. No social action, paid provider, or payment ran.

The authenticated app UI still shows campaign #4 active, approval required ON, zero leads, the background service stopped, and `@rudravejpara03012008` selected as its sender. `@timelessmoments.al` is connected through signed-in Chrome in the saved `chrome_read_only` mode; that mode intentionally cannot run campaigns. The signed-in Instagram handle and campaign sender therefore do not match.

Current checks: `npm test` passed 287 tests; `npm run typecheck`, `npm run lint`, `npx next build --webpack`, isolated `npm run smoke:ui`, and fake-provider `npm run smoke:billing` passed. The build, type generation, and UI/billing smoke needed the sandbox's approved local write/socket permissions. No live campaign send, like, follow, comment, AI/API call, Apify run, or payment was performed, and no money was spent.

The owner was asked whether the saved read-only rule should change to let the existing Chrome account run campaigns, with message approval kept ON. Until that ruling, keep the existing `chrome_read_only` behavior and do not claim campaign sending is verified. Live campaign execution still needs a lead in campaign #4, a campaign-capable sender, the worker running, and a separately confirmed test send.

### Disposable end-to-end manual review and dashboard sign-in copy (Codex, 2026-10-22)

The isolated UI smoke now creates a temporary campaign, adds a temporary sender and lead, marks the lead ready, writes a manual first message through the actual lead page, and verifies the saved message is `pending_approval` with zero sent messages. The overview's setup copy now says to check Accounts for sign-in status when accounts are saved, instead of telling everyone to open a login window again.

Verified on the current branch: `npm test` = 296 passed; `npm run typecheck`; `npm run lint`; `git diff --check`; `npx next build --webpack`; `npm run smoke:ui` passed including the new composer path and existing full UI checks; `npm run smoke:billing` passed with the local fake processor only. No live social action, paid API, Apify run, real payment, or spend occurred. The local app remains running at `http://127.0.0.1:3100` with the owner workspace; worker is stopped.

Current owner workspace: the regular Chrome profile `Rudra099` is signed in as `@timelessmoments.al`, and the Accounts page shows that account using signed-in Chrome. Campaign #4 remains active with approval ON and zero leads. There are 23 pending approvals. Activity lists five earlier failed sign-in attempts from the wrong/test windows; they are historical and do not mean the current Chrome profile is signed out. No inbox message text was read.

NOT verified: live qualification of a campaign #4 lead, a real Instagram send, reply sync, or external paid integrations. The test send must wait for a suitable lead and the owner's review/confirmation of its exact message. Anthropic API, Apify, and real Stripe are not configured/verified; no money was spent.

Decisions made: use the owner's existing Chrome profile for campaign DMs, keep approval ON, keep the worker stopped, and do not spend money or send any message during the verification.
Needs from Rudra: no sign-in help is needed now. Add a suitable lead to campaign #4 when ready; then review and explicitly confirm before the first real send. Paid integrations are optional.
Next I will: update PR #13 with this verification and keep the local app ready for the owner's test.

### [2026-10-22] Codex #105: Start and verify the local background service

The owner asked me to resolve the solvable operational issues without another handoff. In the signed-in owner app, I verified campaign #4 has approval ON, `@timelessmoments.al` is its selected active sender through the owner's signed-in Chrome, and both campaign leads are already skipped. The owner workspace had only a queued read-only inbox check and qualification job; there were no queued warm-ups, approved sends, or paid jobs. I started Outreach from the dashboard. The app now reports `Outreach is running`, and its normal stop-after-current-task control is visible. The app still shows 23 messages waiting for owner approval and 0 DMs sent today. No Instagram write, paid AI/API, Apify, or payment action was made; no money was spent.

To give the active campaign a real read-only qualification candidate, I moved the untouched `@richcreditrepair` lead (17,400 saved followers, credit-repair niche, no messages) from draft campaign #3 into campaign #4 using its normal Move lead control. It remains `found`; the single lead record and its existing history are preserved. The worker scheduled its qualification check for 13:42 UTC in the account's permitted work window. At the latest check the worker lease was live, the task was still queued for that time, and the message counts were unchanged. Chrome read-only mode blocks warm-up, so this step cannot like, comment, follow, or send. The lead's country and fit remain unverified until the scheduled profile check runs.

Verification on this branch after startup: `npm test` = 301 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; isolated `npm run smoke:ui`; isolated `npm run smoke:billing` with a local fake payment provider; and `git diff --check` passed. The first smoke attempts were blocked by the sandbox's local IPC restriction; retries with approved local socket access passed using disposable data and sent zero messages/no real payment. GitHub status could not be refreshed because `api.github.com` was unreachable. PR #13 remains draft/unmerged. The active local service is running against the owner's local workspace, not the disposable smoke databases. Continue honoring approval and daily limits; do not claim that live campaign sending, paid integrations, durable reply sync, or hosted operation has been verified.

### [2026-10-22] Codex #102: Move untouched leads between campaigns

Changed: branch `fix/first-run-operability`, PR #13. Lead detail now offers a move only for untouched leads when another active, approval-required campaign has an active campaign-capable sender. The server action rechecks those conditions in a transaction, blocks DNC leads, non-`found` stages, conversation history and queued/running work, clears the old sender assignment, preserves the single globally deduplicated lead record, logs the move, and refreshes old/new campaign and lead views. The target campaign runs its ordinary qualification checks before any message can be prepared. Expanded the disposable UI smoke to exercise success and the active-job refusal.
Verified: `npm test` = 296 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; `npm run smoke:ui`; `git diff --check`. UI smoke verified a single lead moved, sender assignment cleared, stage remained `found`, activity was recorded, and queued work blocked a move. No owner database was changed, no worker or live Instagram activity was run, no message was sent, and no paid provider or payment was used.
NOT verified: live qualification on campaign #4, live worker/DM/reply sync, or real AI, Apify, or Stripe connections. Those checks remain constrained by missing real lead/provider configuration and the no-spend/no-send requirement. This code change does not establish the full prospect-to-reply flow as live verified.
Decisions made: keep global deduplication; move the existing lead record rather than duplicate it. Keep campaign approval on and preserve all existing lead, sender, and send safeguards.
Needs from Rudra: none for this code change. A live test DM still requires review of and explicit confirmation for its exact text; paid calls still require separate approval.
Next I will: update the existing PR #13 branch and keep the owner workspace and worker untouched.

### [2026-10-22] Codex #103: Prevent unsafe replay after a worker crash

Changed: branch `fix/first-run-operability`, PR #13. Added `mayRecoverAfterCrash` as a pure rule: only read-only `qualify`/`check_inbox` and retired no-op `draft_reply` jobs are automatically recovered. Interrupted warm-up, lead search, AI-draft, follow-up-draft, login-window and unknown tasks are held as failed for review; uncertain sends retain their existing special handling. The planner now stops silently recreating terminal failed qualification work. Lead detail provides a manual retry for a failed read-only qualification, with a visible queued state. Updated the full functionality audit to replace stale first-reply, Chrome and smoke claims. No migration/dependency.
Verified: `npm test` = 301 passed; `npm run typecheck`; `npm run lint`; `npx next build --webpack`; `npm run smoke:ui`; `git diff --check`. Tests cover the recovery allow-list, interrupted paid/social jobs, terminal failure not replanned, and one explicit read-only retry with zero messages. The smoke uses temporary data and sends nothing. Local `/login` returned HTTP 200 after production build. No worker, owner data, Instagram write, paid provider, payment, or money was used.
NOT verified: crash recovery against an actual running worker, durable replies in the owner database, any real DM, paid AI/Apify, or Stripe TEST.
Decisions made: never automatically repeat a partially completed Instagram write or paid task after a crash. Keep only idempotent reads and retired no-ops in automatic recovery. Existing message approval and send safeguards remain unchanged.
Needs from Rudra: none for this code change. No-spend work can continue; live paid tests remain intentionally off.
Next I will: push this verified recovery fix to PR #13 and keep the live worker stopped.

### [2026-10-22] Codex #106: Make worker waits and old sign-in failures clear

The dashboard previously said the worker was "handling" work even when the next job was correctly waiting for the account's allowed work window. It also reported five historical sign-in-window failures as generic background task failures. The Overview now names the next queued task and its team-local time, and labels sign-in failures separately with a link to Activity. Mixed/other failed work still gets a visible attention message. No queue, pacing, approval or delivery rule changed.

Verified: 306 tests pass; typecheck, lint, Webpack production build and isolated `npm run smoke:ui` pass. The authenticated owner dashboard at `127.0.0.1:3100` now visibly says "Next lead check at 9:42 AM (team time)" and explains the five old sign-in attempts. The worker remains live, the lead check remains queued for 13:42 UTC, 23 messages remain pending approval and 0 DMs have been sent today. No Instagram write or paid call occurred.
Committed and pushed as `752f42b` to PR #13. GitHub reports the PR open/draft with no configured status checks.
