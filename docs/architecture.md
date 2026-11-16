# Architecture map (Phase 2 app)

A map of where things live, so nobody has to guess. For product rules read the code in `lib/domain/`; for what is built, `docs/BUILD-SLABS.md`.

## Stack
Next.js 16 (App Router, `proxy.ts` instead of middleware) · React 19 · TypeScript · SQLite via `better-sqlite3` · Vitest · Playwright (smoke tests) · Stripe (test mode only).

## Folders
| Path | What it holds | Notes |
|---|---|---|
| `app/` | Pages, layouts, API routes, CSS | Screens only. No business rules. |
| `components/` | Shared UI components | |
| `lib/domain/` | **Pure business rules** (qualify, limits, approval, fit score, auto-reply, connection rules) | One rule, one place. Takes values, returns a result. |
| `lib/engine/` | Message writing: prompts, validation, providers (Anthropic, local) | |
| `lib/services/` | Orchestration: finding leads, drafting, outreach, safety, kill switch, worker lifecycle | Uses domain + db + engine. |
| `lib/leads/` | Apify lead fetching | |
| `lib/db/` | SQLite: `core.ts` (worker and scripts), `index.ts` (web, `server-only`), `migrations.ts`, `repos/` | Migrations are append-only. |
| `lib/auth/` | Sessions, passwords, Google sign-in, login throttle, `requireUser()` in `dal.ts` | |
| `lib/billing/` | At-cost billing, ledger, Stripe TEST integration | Test mode only. |
| `lib/workspaces/` | Company workspaces, invites, sessions, backups | |
| `lib/connectors/` | Connector protocol between app and Chrome extension/companion | |
| `lib/queries/`, `lib/ui/` | Read models for screens; UI copy and form helpers | |
| `worker/` | Background worker: job runner (one lane per Instagram account), Instagram drivers, human-pace helpers | Do not import `server-only` modules. |
| `extension/` | Chrome extension that drives Instagram from the app | |
| `companion/` | Older Node connector (local server) | |
| `scripts/` | `doctor`, `backup`, `import-csv`, smoke tests, build helpers | `npm run doctor` checks a machine is ready. |
| `tests/` | Vitest tests, one file per area | |
| `deploy/vercel/` | The public "front door" page only | `.vercelignore` stops everything else uploading. |
| `phase1/` | The Phase 1 kit (a prompt, not code) | See `.claude/rules/phase1-kit.md`. |

## Flow in one paragraph
A user creates a campaign in the web app. The worker (`worker/runner.ts`) takes jobs in lanes, one lane per Instagram account so an account is never used twice at once. Jobs find leads (`lib/leads/` + `lib/services/findLeads.ts`), qualify them with `lib/domain/` rules, warm them up and write a first message with `lib/engine/`, check safety (`lib/services/safety.ts`), and drive Chrome via the Instagram driver. Everything is stored in SQLite.

## Rules of the road
- Every server action and page calls `requireUser()` first.
- Never import `lib/db/index.ts` from the worker; use `lib/db/core.ts`.
- Add a test for every rule you change; run `npm run check` before a pull request.
