# Outreach

Instagram outreach from a campaign to a prospect's first real reply. The app organizes leads, preparation, message approval, sending and follow-ups. Once someone replies, the app hands the conversation to a person; booking and later conversation are outside this product.

## For a user

The person running Outreach gives you its address. You do not need to install Node.js, run a terminal or sign in to Claude.

- **Your own company (default):** choose **Create a private workspace**, enter your company name and create your account. Your company's campaigns, Instagram accounts, history and billing records are separate from other companies.
- **Joining a team:** open the owner's invitation link, use the invited email, and enter your existing password or create a new account. Invitations expire and work once.
- **Both:** one account can belong to several workspaces. Open **Workspaces** to switch between your private company and teams you have joined. Workspace owners manage invitations and members there.

Start from **Overview** and follow the setup steps. Connect Instagram from **Accounts**, create a campaign, add leads and keep message approval on. An account is connected only after its sign-in has actually been confirmed. Saved account details alone do not prove a connection.

Automatic preparation and writing require a configured, independently metered AI provider, confirmed prices, a payer and an available spending limit. The app does not use the owner's personal Claude subscription. Without paid AI, complete the actual engagement yourself, mark the qualified lead Engaged, then write the three message parts and submit them for approval. The app never treats a planning estimate as real usage.

## For the person running the app

This version uses a persistent computer for SQLite, browser sessions and the background worker. Opening the web app remotely does not move those services to another computer. Public hosting and a customer-ready remote Instagram connection still need separate deployment and live verification; this repository's self-service screens alone do not prove a hosted SaaS release.

Install Node.js 22 or newer, Git and Google Chrome, then:

```bash
git clone https://github.com/rudravejpara099-glitch/infyum-outreach.git
cd infyum-outreach
npm install
npx playwright install chromium
```

Copy `.env.example` to `.env.local` and set a unique, random `SESSION_SECRET` of at least 32 characters. Start the app:

```bash
npm run dev
```

Open http://localhost:3000. The initial setup creates the original team's owner. Subsequent users can register a private workspace or join an invitation. Use the app's **Start Outreach** control to run its local worker; `npm run worker` remains available for the original workspace's operator.

Workspace data lives beneath the configured `DB_PATH` directory, with a separate operational SQLite database and browser-profile directory for each new company. The identity catalog is stored beside the original database as `<DB_PATH>.identity.db`. `npm run backup` snapshots the original database, identity catalog and company databases with a restore manifest. Browser profiles are excluded: reconnect Instagram after restoring, or securely preserve required profiles separately. Keep the complete backup set private; keep them private and out of Git. Existing original-team users and data are preserved when workspace support initializes.

An Instagram sign-in happens in the browser window, never through a password field in Outreach. The owner's existing signed-in Chrome connection is restricted to the original workspace; a new company must use its own isolated browser session. Do not present a browser opening on the operator's computer as a remote customer's finished connection flow.

AI, Apify and Stripe credentials belong to the operator's private configuration. Apify also requires a saved monthly cap. Billing remains in **test mode**. Do not enable paid calls, real charges or Instagram actions without the owner's approval. Confirm the actual configured provider and exact model prices before enabling automatic writing.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run smoke:ui
npm run smoke:billing
npx tsx scripts/workspace-smoke.ts
```

Browser smoke tests use disposable data. Billing smoke uses a local fake payment provider. Workspace smoke checks two separate companies, invitations, switching, access removal and session revocation without a worker or external provider calls. These checks do not substitute for an approved live first-message and first-reply test.

Read `HANDOFF.md` for current evidence and remaining verification, `docs/DESIGN.md` for the interface rules, `docs/COLLAB.md` for ownership, and `AGENTS.md` before changing code.

## Code map

| Folder | Responsibility |
|---|---|
| `lib/domain/` | Pure rules for qualification, stages, limits, similarity and workspace validation |
| `lib/db/` | SQLite schema and small table repositories; migrations are append-only |
| `lib/workspaces/` | Company membership, invitations, sessions and isolated storage |
| `lib/auth/` | Password verification and request authentication |
| `lib/services/` | Outreach transitions, drafting and first-reply handoff |
| `lib/engine/` | Metered AI provider and message prompts/validation |
| `lib/billing/` | Integer micro-dollar accounting, usage, limits and test payments |
| `worker/` | Background planning, jobs and Instagram browser adapters |
| `app/` | Pages and server actions; protected entry points authenticate first |

For a rule change, update its pure function and regression test. Run tests and typecheck before committing. Never edit a shipped migration.
