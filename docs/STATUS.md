# Status: what is true right now

**This file describes the present. Edit it in place when a fact changes. Do not append dated entries.** History is in `docs/archive/` and in git.

Last verified: 2026-11-16, on a fresh clone of `main` (after PR #100).

## Verified
| Check | Result |
|---|---|
| `npm ci` | installs cleanly (Node 22) |
| `npm run typecheck` | passes |
| `npm run lint` | passes |
| `npm test` | 90 files, 730 tests, all pass (46 Phase 1 kit checks, 5 security headers, 8 registration gate) |
| `npm run build` | passes (with `SESSION_SECRET` set, as CI does) |

## The two products
- **Phase 1 kit** (`phase1/`): a prompt that a user's own Claude runs through their own Chrome. It finds prospects (Apify), qualifies them, warms them up, sends **one first message**, and stops. Leads live in a Google Sheet. Scope is final: the system **stops after the first DM** (decided 2026-10-29). No daily caps; the aim is 35 first messages a day.
- **Phase 2 app** (`app/`, `lib/`, `worker/`, `extension/`, `companion/`): a Next.js web app that automates the same process on the user's own computer. Its slab-by-slab status against the build plan is in `docs/BUILD-SLABS.md`.

## Known gaps (found in the 2026-11-16 audit)
- **Pushing workflow files from this Mac fails.** The GitHub CLI login lacks the `workflow` permission (refreshing it did not take). `.github/workflows/ci.yml` was added through the GitHub website instead. To change a workflow file again, either fix that login or edit it on github.com.
- **The kit's checks are structural, not behavioural.** `npm run kit:check` (part of `npm test`) catches broken references, renamed columns, disagreeing numbers, removed safety rules and unrecorded edits. It cannot tell whether Claude actually behaves well when it follows the guide; only a real supervised run shows that.
- **Two small existing flaws in the guide, left as they are** (changing live wording is the owner's call): Appendix A says "the questions round (2.6)" but the questions are in 2.2 (2.6 is "Put the answers to work"); hard rule 9 is not bold like the others.
- **The app and the kit may disagree on message rules.** The archived handoff describes three DMs plus follow-ups; the kit sends one to three messages and stops. Not verified whether `lib/engine/` still reflects the older rules. Ask the owner before changing either.
- **Not verified:** `npm run smoke:ui` on a fresh clone; the Chrome extension; anything that needs live Instagram, Apify, Anthropic or Stripe.
- **Branches:** the remote has many stale branches. Delete only with the owner's OK.

## Security (first-pass review, 2026-11-16)
Reviewed by reading the code, not by attacking a running deployment. This is not a penetration test.

**Held up:** session cookie (httpOnly, sameSite lax, secure in production, server-side revocable); scrypt passwords with constant-time compare; per-email login throttle; production refuses to start with a weak `SESSION_SECRET`; Google sign-in (PKCE, state, nonce, ID-token checks); Stripe webhook (signature check, 1 MB cap, test mode only); connector endpoints (device token, origin allowlist, 128 KB cap, authority re-checked on every task); invite and device tokens (32 random bytes, stored hashed); SQL (parameterised; the three interpolations only use constants); no committed secrets in files or history.

**Fixed:**
- No security headers on pages: added frame blocking, nosniff, referrer policy, permissions policy, HSTS in production (checked on a running production build). 3 production dependency vulnerabilities, one high (`npm audit fix`, now 0 in production).
- **Public sign-up is closed by default.** `/register` used to let anyone who reached the address create an account and a workspace (no approval, no cap, no email check, per-email throttle only, and it revealed which emails were registered). Now `ALLOW_REGISTRATION=true` must be set to open it; the gate is enforced in the server action itself, not only on the page. Invitations (`/join`) and first-time setup (`/setup`, only while there are no users) are unchanged. **If your team relied on open sign-up, set `ALLOW_REGISTRATION=true` in `.env.local` and restart.** Verified on a production build in both modes.

**Still open:**
- `main` is not protected (GitHub needs a paid plan or a public repo for a private repo).
- No full Content-Security-Policy for scripts (needs per-request nonces; inline scripts exist). Own change.
- `next.config.ts` lets Server Actions accept posts from any `*.trycloudflare.com` address. Cookies are sameSite lax, which limits the risk, but the wildcard exists because the quick-tunnel address changes. A named tunnel would allow an exact address.
- Login throttle counts per email only, not per address: someone can lock a known email out, and guessing across many emails is not slowed.
- 8 moderate vulnerabilities remain in dev-only tooling (eslint and TypeScript lint plugins). They need breaking upgrades and are not shipped.
- The app is reachable from the internet through a Vercel address forwarding to a tunnel to one Mac. If the database there is ever empty, `/setup` lets the first visitor claim the owner account. Not verified: whether a stranger with an invitation-less login could use the Mac's worker, local AI or paid API keys (Apify, Anthropic); workspaces are separate databases, but the worker is shared.

## Open decisions for the owner
- Whether the repo should go back to private (raised in the old collaboration board, never answered).
- Whether to split the kit and the app into two repositories, or keep one repo with separate owners per folder (current setup).
