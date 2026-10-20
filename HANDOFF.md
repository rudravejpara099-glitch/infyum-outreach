# Handoff: Infyum Outreach (read this first)

You are taking over a half-finished internal web app. Everything below is decided. Do not re-litigate decisions, build on them. Keep the code simple and reliable: one language (TypeScript), small files, pure rules separated from I/O, tests on anything risky.

## What the product is
Instagram outreach for INFYUM (a funnel and landing page team in India). A campaign picks an audience; the app finds leads, checks them, warms them up (likes, comments, follow), sends three custom DMs, reads replies, answers them, sends follow-ups, and stops when a call is booked. Internal use by the company team only for now. Public version later (needs paid Claude API billing, see "Decided").

Business rules the code must keep:
- Lead qualifies only if: public account, based in the campaign country (from Instagram "About this account"), followers inside the campaign range (default 2,000 to 150,000), not connected to Infyum, never contacted, not on do-not-contact. Order of checks and wording of reasons: `lib/domain/qualify.ts`. Posting recency and engagement are deliberately ignored.
- Warm-up per lead: 10 pieces, like each, comment on each (3 to 8 words, 1 to 3 emojis, no dashes), religion/politics/grief posts like only, follow last.
- First contact is exactly three separate DMs, written fresh each time: (1) one true specific detail about them, (2) who we are (Rudra at Infyum, team in India) plus the only allowed link https://portfolio.infyum.com/sales-funnel, (3) one curious question. No guessed names, no invented results/prices, no dashes, no copied openings (similarity guard against the last 10 sent). Rules live in `lib/engine/prompts.ts` and `lib/engine/validate.ts`.
- Follow-ups: max 2, first after 2 days, next after 4, each adds something new, never "just checking in".
- Replies: answer what they said first, then one next step toward a call. Price, contract, dates, guarantees, partnership terms, legal and upset replies ALWAYS wait for a human (`lib/domain/sensitive.ts`), even with approval off. Partnerships: white label and affiliate only. Automatic "thanks for contacting us" replies are not real replies (`lib/domain/autoreply.ts`).
- Daily limit per Instagram account: default 35 with slow ramp-up (10, then 20, then cap), hard ceiling 60 (`lib/config.ts`). The worker stops an account the moment Instagram shows a warning or human check.
- Booking link is per campaign (default: https://calendly.com/rudravejpara099/infyum-funnel-meta-ads-intro-call, 30 min).

## Decided (from a grill-me interview with the owner)
- Runs locally on the owner's Mac for now (localhost). Each connected Instagram account gets its own Chrome profile driven by Playwright; the owner logs in by hand once, the app never sees passwords.
- AI = the `claude` command signed in on the machine (owner's subscription), behind one interface `AiEngine` (`lib/engine/types.ts`). No API keys now. For the public version, add another class implementing `AiEngine` (paid API or bring-your-own) and change one line in `lib/engine/index.ts`. Do not resell the subscription.
- Approval queue: on by default, switchable per campaign. Replies follow the same switch plus the always-human topics above.
- Pipeline stages: found, qualified, warmed, dm_sent, replied, call_offered, booked, closed, plus skipped (with reason). One transition table in `lib/domain/stages.ts`.
- Apify for lead search: free plan only, off until a monthly dollar cap is saved in Settings (`apify_monthly_cap_usd`). Stops at 90% of the cap. Never spend beyond the cap.
- Simple email + password login, one role, internal team of about 3 to 5.
- Extras in v1: global dedupe, do-not-contact list, similarity block, dashboard, CSV export of the action log.
- Look: Apple-style calm plus Linear-style density, Infyum brand: blue #188BF6 / #155EEF, yellow #FFCB00, green #37CA37, ink #222325; headings Plus Jakarta Sans, text Inter. Tokens in `app/globals.css`. Light and dark both supported. Avoid generic AI-looking UI.

## State of the code (7+ commits, `npm test` = 52 passing, `npx next build` passes)
Built and tested:
- `lib/domain/*` rules (stages, qualify, limits, similarity, approval, sensitive, autoreply)
- `lib/db/*` SQLite (better-sqlite3), append-only migrations in `lib/db/migrations.ts`, one repo file per table in `lib/db/repos/`
- `lib/services/*` flows: afterSent, handleIncoming, markDoNotContact, drafting (AI + validation + retry), findLeads (Apify)
- `worker/runner.ts` job orchestration (qualify, warmup, draft_dm, send, check_inbox, draft_reply, draft_followup, find_leads, open_login) tested end to end with a fake Instagram driver (`tests/runner.test.ts`)
- Screens: login/setup, dashboard, campaigns (list/new/edit/add leads/find leads), pipeline board, lead page, approvals, inbox, accounts, activity (+CSV export), settings
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
