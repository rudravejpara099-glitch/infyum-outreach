# Status: what is true right now

**This file describes the present. Edit it in place when a fact changes. Do not append dated entries.** History is in `docs/archive/` and in git.

Last verified: 2026-11-16, on a fresh clone of `main` (after PR #100).

## Verified
| Check | Result |
|---|---|
| `npm ci` | installs cleanly (Node 22) |
| `npm run typecheck` | passes |
| `npm run lint` | passes |
| `npm test` | 88 files, 717 tests, all pass (46 of them are the Phase 1 kit checks) |
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

## Open decisions for the owner
- Whether the repo should go back to private (raised in the old collaboration board, never answered).
- Whether to split the kit and the app into two repositories, or keep one repo with separate owners per folder (current setup).
