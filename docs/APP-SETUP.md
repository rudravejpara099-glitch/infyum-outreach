# Outreach web app (Phase 2): setup

This is the setup guide for the Phase 2 web app. To use Instagram outreach today with just Claude and Chrome, see the [main README](../README.md).

Instagram outreach from a campaign to a prospect's first real reply. The app organizes leads, preparation, message approval, sending and follow-ups. Once someone replies, the app hands the conversation to a person; booking and later conversation are outside this product.

## For a user

The person running Outreach gives you its address. You do not need to install Node.js, run a terminal or sign in to Claude.

- **Your own company (default):** choose **Create a private workspace**, enter your company name and create your account. Your company's campaigns, Instagram accounts, history and billing records are separate from other companies.
- **Joining a team:** open the owner's invitation link, use the invited email, and enter your existing password or create a new account. Invitations expire and work once.
- **Both:** one account can belong to several workspaces. Open **Workspaces** to switch between your private company and teams you have joined. Workspace owners manage invitations and members there.

Start from **Overview** and follow the setup steps. Connect Instagram from **Accounts**, create a campaign, add leads and keep message approval on. An account is connected only after its sign-in has actually been confirmed. Saved account details alone do not prove a connection.

Automatic preparation and writing can use the server’s free local model. A paid Anthropic connection instead requires confirmed prices, metering, a payer and an available spending limit. The app does not use the owner's personal Claude subscription. Without paid AI, complete the actual engagement yourself, mark the qualified lead Engaged, then write the three message parts and submit them for approval. The app never treats a planning estimate as real usage.

## For the person running the app

This version uses a persistent computer for SQLite, browser sessions and the background worker. Opening the web app remotely does not move those services to another computer. Customer browser pairing is implemented and tested through the website/device protocol. A public release still needs a signed/notarized connector, independent customer-machine verification and public deployment; the current app remains local.

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

Workspace data lives beneath the configured `DB_PATH` directory, with a separate operational SQLite database and browser-profile directory for each new company. The identity catalog is stored beside the original database as `<DB_PATH>.identity.db`. `npm run backup` snapshots the original database, identity catalog and company databases with a restore manifest. Browser profiles are excluded: reconnect Instagram after restoring, or securely preserve required profiles separately. Keep the complete backup set private and out of Git. Existing original-team users and data are preserved when workspace support initializes.

An Instagram sign-in happens in the browser window, never through a password field in Outreach. The owner's existing signed-in Chrome connection is restricted to the original workspace; a new company connects its own Chrome with Outreach Connector. Choose Connect my Chrome in Accounts, download/open the Mac helper, create a one-time code and pair it. The website never receives Instagram passwords or browser cookies. Do not present a browser opening on the operator's computer as a remote customer's finished connection flow.

AI, Apify and Stripe credentials belong to the operator's private configuration. Apify also requires a saved monthly cap. Billing remains in **test mode**. Do not enable paid calls, real charges or Instagram actions without the owner's approval. Confirm the actual configured provider and exact model prices before enabling automatic writing.

## Free local writing (server administrator)

Normal users do not need Claude, API keys or their own model installation. The server administrator installs Ollama and a local GGUF model, keeps Ollama bound to loopback and sets `OLLAMA_NO_CLOUD=1`. Select it in the private app environment:

```text
AI_PROVIDER=local
LOCAL_AI_MODEL=qwen2.5:7b
```

The adapter checks local model metadata before every generation and rejects cloud-backed aliases. There is no paid fallback or usage charge for local inference. Comment and message rules still apply, and first messages remain in the approval queue. If the model goes offline, the app shows the problem and pauses preparation.

## Connect your own Chrome with the extension (no debugging switch)

This is the route that was proven live on 2026-11-03. It needs no `chrome://inspect` setting and no Mac download.

1. Build it if needed: `npm run extension:build` (the generated files in `extension/` are committed; a test keeps them in sync).
2. In Chrome open `chrome://extensions`, turn on **Developer mode**, remove any old "Infyum Outreach" card (one that points at a folder that no longer exists shows "file not found"), then **Load unpacked** and pick this repository's `extension/` folder.
3. In the app open **Accounts**, then **Connect your Chrome** (`/accounts/connect`) and press **Create connection code**. The code lasts 5 minutes and works once.
4. Click the extension's icon, paste the code and press **Connect**. The page then says "1 computer is online".
5. On the same page choose the Instagram account (its handle and a small daily limit) and press **Check my Instagram sign-in**. The extension opens that account's own profile in a background tab and answers true only if the "Edit profile" button is there. It reads only.

The extension checks in every 5 seconds, so it is back within about 15 seconds after the app restarts. It reloads itself when the app ships a newer version (the version in `extension/manifest.json`); you only need to reload it by hand after the first install. To stop everything at once use **Stop everything** in the app or the extension's Stop button.

## Google Sheet (server administrator)

The team Sheet mirrors every lead, job and action, and a name added to **Do-not-contact** or a changed **Stage** in the Sheet flows back into the app. Keys and tokens are never written to it.

1. In Google Cloud, use the same OAuth "Web application" client as Google sign-in (or create one) and add the redirect address `<APP_URL>/api/sheets/google/callback`, for example `http://localhost:3000/api/sheets/google/callback`. Enable the **Google Sheets API** for the project.
2. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and (when not on localhost) `APP_URL` in `.env.local`, then restart the app and the background service.
3. In **Settings**, find **Google Sheet** and press **Connect Google Sheets**. Google asks only for access to spreadsheets. The lasting token is stored encrypted (AES-256-GCM, key derived from `SESSION_SECRET`) in the workspace's settings, so keep `SESSION_SECRET` stable: changing it makes the stored token unreadable and you simply connect again.
4. Press **Create the Sheet** (or paste the link of a Sheet you already have). The background service then creates the five tabs (Leads, Settings, Jobs, Activity Log, Do-not-contact) with a locked header row and a Stage dropdown, and syncs once a minute. A failed sync is logged, shown in Settings and retried; it never stops outreach.

A person's own labels "Follow-up due" and "Call booked" on a handed-over lead are never overwritten. If both sides changed the same lead, the person's edit in the Sheet wins when the app allows it, and a `sheet.conflict` line is logged. A username that is in the Leads tab but unknown to the app is blocked in the app.

## Instagram safety and pacing

On 2026-11-03 Instagram locked the test account (`We locked your account to protect you from a possible hack`) minutes after a run with human pacing switched off: a warm-up and a DM within about ten minutes, from an account with no posts and 10 followers. The lessons are built in:

- **Human pacing is on by default**: working hours, session lengths, rests, lunch and waits between jobs (`lib/domain/pacing.ts`). `HUMAN_PACING=off` turns it off and is not recommended.
- **Lock and challenge pages stop the app**: `/auth_platform/`, `/challenge`, `/accounts/suspended` and the lock screen's text count as a hard stop in the worker and the extension.
- **Use a spare or well-used account** for any live test, a small daily cap (the week-one ramp is about 5 actions a day), and keep **Ask me before anything is sent** on.
- Restarting the app needs the old server gone first: `lsof -ti :3000 | xargs kill`, then `npm start`. `pkill -f "next start"` does not stop `next-server`.

## Customer connector (server administrator)

Build the Mac download with `node --import tsx scripts/build-connector.ts --verify`. This bundles the installed runtime and checks the actual packaged executable using disposable data. The current package targets Apple silicon Macs; it is unsigned and not notarized. Do not bypass macOS security or present it as verified public distribution. A Developer ID signing identity is not available on this machine. Disconnecting a device revokes its credential; quitting the helper preserves pairing for reopening. Other companies cannot claim its account commands.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run smoke:ui
npm run smoke:billing
npx tsx scripts/workspace-smoke.ts
# Optional real local inference, synthetic data only:
LOCAL_AI_MODEL=qwen2.5:7b npx tsx scripts/local-writing-smoke.ts
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
