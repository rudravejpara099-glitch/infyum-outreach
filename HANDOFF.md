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
