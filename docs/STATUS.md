# Status: what is true right now

**This file describes the present. Edit it in place when a fact changes. Do not append dated entries.** History is in `docs/archive/` and in git.

Last verified: 2026-11-16, on `main` after the safeguards change.

## Decisions in force (owner, 2026-11-16)
- **Phase 1 kit is the product. The Phase 2 app is paused:** it stays working with tests green, gets no new features, and PR #96 is closed (its branch is kept). Resume only on the owner's say-so.
- **The kit's message rules win** over the app's (decision 0003). The app's engine is rewritten to match when Phase 2 resumes.
- **No paid GitHub plan.** `main` cannot be protected on a free private repo, and this is accepted. Safeguards instead: a Claude Code hook blocks `git push` to `main` (`.claude/hooks/guard.mjs`, tested), the rule "branch, then pull request" in `AGENTS.md`, and CI reporting on every PR. People and other tools can still push straight to `main`.
- **The public address (Vercel to a tunnel to one Mac) is off.** It currently answers 502 and no tunnel runs.

## Verified
| Check | Result |
|---|---|
| `npm ci` | installs cleanly (Node 22) |
| `npm run typecheck` | passes |
| `npm run lint` | passes |
| `npm test` | 91 files, 764 tests, all pass (46 Phase 1 kit checks, 6 security headers, 8 registration gate, 33 Claude guard) |
| `npm run build` | passes (with `SESSION_SECRET` set, as CI does) |

## The two products
- **Phase 1 kit** (`phase1/`): a prompt that a user's own Claude runs through their own Chrome. It finds prospects (Apify), qualifies them, warms them up, sends **one first message**, and stops. Leads live in a Google Sheet. Scope is final: the system **stops after the first DM** (decided 2026-10-29). No daily caps; the aim is 35 first messages a day.
- **Phase 2 app** (`app/`, `lib/`, `worker/`, `extension/`, `companion/`): a Next.js web app that automates the same process on the user's own computer. **Paused.** Its slab-by-slab status is in `docs/BUILD-SLABS.md`.

## Known gaps
- **Pushing workflow files from this Mac fails.** The GitHub CLI login lacks the `workflow` permission (refreshing it did not take). `.github/workflows/ci.yml` was added through the GitHub website instead. To change a workflow file again, either fix that login or edit it on github.com.
- **The kit's checks are structural, not behavioural.** `npm run kit:check` (part of `npm test`) catches broken references, renamed columns, disagreeing numbers, removed safety rules and unrecorded edits. It cannot tell whether Claude actually behaves well when it follows the guide; only a real supervised run shows that. **No real run has been recorded yet; one is the finish line of this clean-up.**
- **The app and the kit disagree on message rules (known, deliberate for now).** The app's engine (`lib/engine/prompts.ts`, `validate.ts`) writes exactly three DMs with the link in message 2 and sends up to two follow-ups; the kit sends one to three messages, stops after the first, and uses the link in the Sheet's Settings. The kit wins. Not changed while Phase 2 is paused.
- **Not verified:** `npm run smoke:ui` and the workspace browser smoke test on a fresh clone; the Chrome extension; anything that needs live Instagram, Apify, Anthropic or Stripe.

## Branches
- Merged branches are renamed under `archive/` (nothing deleted; each keeps its commits). Bring one back by making a branch from it.
- **Unmerged work, owner to decide (nothing is done with these):** `docs/phase2-slab-checklist` (the Phase 2 work, PR #96, closed; it is also the branch checked out in the owner's local copy), `feat/sunil-dm-writer` (an app DM-writer quality bar, 2026-11-14), `feat/plain-language-ux` (PR #2 was closed, not merged), `phase1-grill-me-onboarding` (probably older than the current guide; not confirmed).

## Security (first-pass review, 2026-11-16)
Reviewed by reading the code, not by attacking a running deployment. This is not a penetration test.

**Held up:** session cookie (httpOnly, sameSite lax, secure in production, server-side revocable); scrypt passwords with constant-time compare; per-email login throttle; production refuses to start with a weak `SESSION_SECRET`; Google sign-in (PKCE, state, nonce, ID-token checks); Stripe webhook (signature check, 1 MB cap, test mode only); connector endpoints (device token, origin allowlist, 128 KB cap, authority re-checked on every task); invite and device tokens (32 random bytes, stored hashed); SQL (parameterised; the three interpolations only use constants); no committed secrets in files or history.

**Fixed:**
- No security headers on pages: added frame blocking, nosniff, referrer policy, permissions policy, HSTS in production (checked on a running production build). 3 production dependency vulnerabilities, one high (`npm audit fix`, now 0 in production).
- **Public sign-up is closed by default.** `ALLOW_REGISTRATION=true` must be set to open `/register`; enforced in the server action itself. Invitations (`/join`) and first-time setup (`/setup`, only while there are no users) are unchanged. If your team relied on open sign-up, set `ALLOW_REGISTRATION=true` in `.env.local` and restart.
- **The `*.trycloudflare.com` wildcard is removed** from the Server Actions allowlist (`next.config.ts`); only the exact Vercel host remains. A test fails if a wildcard comes back.

**Accepted or deferred:**
- `main` is not protected (decision above).
- No full Content-Security-Policy for scripts (needs per-request nonces; inline scripts exist). Deferred while the public address is off.
- Login throttle counts per email only, not per address. Deferred while the public address is off.
- 8 moderate vulnerabilities remain in dev-only tooling (lint plugins). They need breaking upgrades and are not shipped.
- If the identity database is ever empty, `/setup` lets the first visitor create the owner account. Not verified: whether a stranger with a login could use the Mac's shared worker, local AI or paid API keys; workspaces are separate databases but the worker is shared.

**Before the public address is switched on again:** add the tunnel's exact host to `allowedOrigins` (a named tunnel keeps it stable), add a per-address login throttle, add a script CSP, keep `ALLOW_REGISTRATION` unset, and check that the identity database is not empty.

## Open decisions for the owner
- Whether to split the kit and the app into two repositories, or keep one repo with separate owners per folder (current setup).
- What to do with the three unmerged branches listed above.
