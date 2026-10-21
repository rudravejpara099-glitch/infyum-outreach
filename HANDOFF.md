# Handoff: Infyum Outreach (read this first)

You are taking over a half-finished internal web app. Everything below is decided. Do not re-litigate decisions, build on them. Keep the code simple and reliable: one language (TypeScript), small files, pure rules separated from I/O, tests on anything risky.

## What the product is
Instagram outreach for INFYUM (a funnel and landing page team in India). A campaign picks an audience; the app finds leads, checks them, warms them up (likes, comments, follow), sends three custom DMs, sends follow-ups, and stops at the lead's first real reply (scope ruling, Oct 20: our only job is getting the first message back; a person or the GoHighLevel agent handles the rest, not connected yet). Internal use by the company team only for now. Public version later (needs paid Claude API billing, see "Decided").

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
- AI = the `claude` command signed in on the machine (owner's subscription), behind one interface `AiEngine` (`lib/engine/types.ts`). No API keys now. For the public version, add another class implementing `AiEngine` (paid API or bring-your-own) and change one line in `lib/engine/index.ts`. Do not resell the subscription.
- Approval queue: on by default, switchable per campaign. Replies follow the same switch plus the always-human topics above.
- Pipeline stages: found, qualified, warmed, dm_sent, replied (hand-off), closed ("Stopped"), plus skipped (with reason). One transition table in `lib/domain/stages.ts`.
- Apify for lead search: free plan only, off until a monthly dollar cap is saved in Settings (`apify_monthly_cap_usd`). Stops at 90% of the cap. Never spend beyond the cap.
- Simple email + password login, one role, internal team of about 3 to 5.
- Extras in v1: global dedupe, do-not-contact list, similarity block, dashboard, CSV export of the action log.
- Look (owner revision, 2026-10-20): liquid-glass depth and fluid interactions, a plain “Outreach” app identity with no company logo, light/dark/system appearance, and HIG hierarchy/progressive disclosure. Plus Jakarta Sans and Inter remain. See `docs/DESIGN.md`. This supersedes the original flat, company-branded UI direction; outbound business identity and messaging rules are unchanged.

## State of the code (7+ commits, `npm test` = 52 passing, `npx next build` passes)
Built and tested:
- `lib/domain/*` rules (stages, qualify, limits, similarity, approval, sensitive, autoreply)
- `lib/db/*` SQLite (better-sqlite3), append-only migrations in `lib/db/migrations.ts`, one repo file per table in `lib/db/repos/`
- `lib/services/*` flows: afterSent, handleIncoming, markDoNotContact, drafting (AI + validation + retry), findLeads (Apify)
- `worker/runner.ts` job orchestration (qualify, warmup, draft_dm, send, check_inbox, draft_followup, find_leads, open_login) tested end to end with a fake Instagram driver (`tests/runner.test.ts`)
- Screens: login/setup, dashboard, campaigns (list/new/edit/add leads/find leads), pipeline board, lead page, approvals, replies (hand-off list), accounts, activity (+CSV export), settings
- `scripts/import-csv.ts` imported the old spreadsheet (132 leads, 105 sent DMs) into `data/outreach.db`

NOT verified (do these first, they need the owner's logins):
1. `worker/instagram.ts` (Playwright driver) was written from memory of Instagram's UI and has never run against the live site. Selectors, "About this account" parsing, the followers/following search boxes, comment box, Message button, DM textbox and inbox reading all need a live check. Test read-only steps first (readFacts, readProfileNotes) before anything that likes, comments, follows or sends. Never retry past an Instagram warning: it must stop the account.
2. `lib/engine/claude-cli.ts` ran but the CLI answered "OAuth access token has been revoked". The owner must run `claude` once and sign in, then re-run a draft to confirm output parses (`lib/engine/validate.ts`).
3. `lib/leads/apify.ts` is tested only with canned data. First real run: confirm the actor id (`apify~instagram-search-scraper` by default, overridable via setting `apify_actor`), its input fields (`search`, `searchType`, `resultsLimit`) and output field names (`username`, followers).

## Next tasks, in order
1. Get the owner signed in to `claude`, connect one Instagram account in the app, live-test the driver read-only, fix selectors.
2. Live-test warm-up with a single throwaway lead on a campaign with approval ON, then sending one approved DM.
3. Run `check_inbox` live; fix handle detection from threads.
4. Apify first real run with a tiny cap.
5. Polish: empty and error states, keyboard focus, mobile widths. Run the `hig-foundations` and `hig-patterns` skills if available.
6. Later: hosting on a server, multi-company accounts, payments (explicitly out of scope for v1).

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

Multi-company isolation, broader roles, hosted workers, deployment/retention operations, account recovery and live payment enablement still require owner decisions and review. The approved billing work is TEST-only in PR #7, with no plans/tiers/subscription price, margin default zero and no personal-subscription resale. No new host/service or live charge is authorized here. Taxes and terms of service need a qualified person’s review before taking real money. The internal app still shares one workspace/role; the first app user is not an inferred billing owner. GoHighLevel integration and post-first-reply conversations/booking are not implemented by this scope.

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
