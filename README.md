# Infyum Outreach

Internal web app for Instagram outreach: choose an audience, find and check leads, warm them up, send three custom DMs and follow up, until the lead sends a first reply. Our job ends there: a person or the GoHighLevel agent handles the conversation and the booking.

## Quick start for a teammate (about 10 minutes)

You need: a Mac or PC with Node.js 22 or newer, Git, and Google Chrome.

1. Get the code and install:
   ```bash
   git clone https://github.com/rudravejpara099-glitch/infyum-outreach.git
   cd infyum-outreach
   npm install
   npx playwright install chromium
   ```
2. Copy `.env.example` to `.env.local` and set `SESSION_SECRET` to any long random text.
3. Start the app in one terminal: `npm run dev`, then open http://localhost:3000. The first visit asks you to create the first account (the first person to do this on a computer becomes its admin). Add teammates later in Settings.
4. Optional, to let the app work on its own, start the worker in a second terminal: `npm run worker`.
5. Run `claude` once in a terminal and sign in (the worker uses it to write DMs).
6. On the Accounts page, connect an Instagram account and sign in by hand in the window that opens.

Each computer has its own private database (`data/`, never uploaded). Leads and settings do NOT sync between computers yet. To share one set of data, run the app on one computer and have everyone use that one.

Start here to understand it: `HANDOFF.md` (rules, decisions, what is done and what is not), `docs/DESIGN.md` (how it must look), `AGENTS.md` (for coding agents).

Check it works: `npm test` (52 tests) and `npm run typecheck`.

## Run it

```bash
npm install
npx playwright install chromium     # once
npm run dev                         # the web app, http://localhost:3000
npm run worker                      # the background worker (separate terminal)
npm run import -- "<path>/engaged.csv"   # optional: import the old spreadsheet
npm test                            # unit tests
```

First visit asks you to create the first account. Add teammates in Settings.
Set `SESSION_SECRET` in `.env.local` before anyone else uses it.

Two sign-ins are yours to do, the app never handles passwords:
1. **Claude:** run `claude` once in a terminal and sign in. The worker uses it to write DMs (your subscription, no API key).
2. **Instagram:** Accounts page, Connect account. A browser window opens; sign in there and close it.

## How it is organised (change one thing without breaking another)

| Folder | Job | Touches |
|---|---|---|
| `lib/domain/` | The rules: pipeline stages, who qualifies, daily limits, similarity guard, what needs approval. Pure functions, no database, no browser. | nothing else |
| `lib/db/` | SQLite schema (append-only migrations) and one small file per table. | domain types |
| `lib/services/` | Multi-step flows: after a message is sent, when a reply arrives, drafting. | domain, db, engine |
| `lib/engine/` | The AI. One interface, one implementation (the `claude` command). All prompts live in `prompts.ts`. | nothing else |
| `worker/` | Plans work, runs jobs, talks to Instagram through one interface (`driver.ts`). | services |
| `app/` | Screens and server actions. Every action calls `requireUser()` first. | db, services |

Where to change common things:
- **Voice or message rules:** `lib/engine/prompts.ts` and `lib/engine/validate.ts`
- **Who qualifies:** `lib/domain/qualify.ts`
- **Daily limits and ramp-up:** `lib/domain/limits.ts`
- **What always needs a human:** `lib/domain/sensitive.ts`
- **Follow-up timing:** `lib/services/outreach.ts` (2 days, then 4, max 2)
- **Pipeline columns:** `lib/domain/stages.ts`
- **Switch to paid Claude API:** add a class implementing `AiEngine`, change one line in `lib/engine/index.ts`
- **Brand colours and fonts:** `app/globals.css`

Rule for changes: edit the pure rule, run `npm test`, then look at the screen. The tests cover the parts that matter most (limits, dedupe, approval, similarity, the whole worker flow with a fake Instagram).

## Safety built in
- Per-account daily cap with slow ramp-up, hard ceiling in `lib/config.ts`
- Account is stopped the moment Instagram shows a warning or a human check
- Price, contract, date, guarantee, partnership and upset-reply talk always waits for a person
- DMs too similar to the last 10 are held
- "Never contact again" is permanent
- Every action is logged (Activity page, CSV export)

## Not built yet
- Apify lead search is built and tested against canned data only. It has not run against the real Apify yet: check the first run's results and the actor's output fields (`lib/leads/apify.ts`). Needs `APIFY_TOKEN` in the worker's environment and a monthly limit in Settings.
- Running on a live server (this version is for one computer)
