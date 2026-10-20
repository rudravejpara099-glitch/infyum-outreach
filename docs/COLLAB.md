# Collaboration board: Claude Code and Codex (ChatGPT)

Two AI agents and one owner work on this repo. We cannot talk live, so this file is the conversation. Read it fully before you start, add an entry when you stop. The owner (Rudra) reads it too and decides anything we disagree on.

## Rules (both agents, no exceptions)
1. GitHub `main` is the only truth. `git pull` before you start. Never work from a stale copy.
2. Nobody commits straight to `main`. One branch per task (`feat/...`, `fix/...`, `docs/...`), then a pull request. The owner or the other agent merges.
3. One owner per area at a time (table below). To work in the other's area, post a request here first and wait for ACK.
4. Tests and typecheck must pass before a pull request: `npm test`, `npm run typecheck`, `npx next build`.
5. Every entry uses the format below, so nothing is left to guess.
6. If an entry needs a reply, it says "NEEDS ACK". The reader replies `ACK <id>` or `DISAGREE <id>: reason` in their next entry. The sender does not build on a NEEDS ACK point until it is ACKed or the owner rules.
7. Never claim something works unless you ran it. Say what you ran. List what you did NOT verify.
8. If you are unsure what the owner meant, do not guess in code: write the question under "Open questions" and ask the owner.

## Entry format (copy this)
```
### [YYYY-MM-DD] <Agent> #<n>: <title>
Changed: <branch/PR, files or areas>
Verified: <exact commands run and results>
NOT verified: <what you could not or did not check>
Decisions made: <anything the other agent must respect>
Needs from you: <question or request, mark NEEDS ACK if blocking>
Next I will: <the next concrete step, so the other agent does not duplicate it>
```

## Who owns what
| Area | Owner | Others may |
|---|---|---|
| `app/`, `components/`, CSS, `docs/DESIGN.md`, `docs/UI-REVIEW.md`, `scripts/ui-smoke.ts` (screens, look, UI smoke test) | Codex | read; request changes |
| `worker/`, `lib/domain/`, `lib/engine/`, `lib/services/`, `lib/leads/`, `lib/db/repos/` (rules, workers, AI, Instagram, data) | Claude | read; request changes |
| `lib/db/migrations.ts` | whoever needs a migration, after claiming the number below | append only |
| `package.json`, `package-lock.json`, `next.config.ts` | either, but announce here first | |
| `HANDOFF.md` | each agent edits only its own dated section; the owner's rules at the top change only with owner approval | |
| `tests/` | the owner of the code being tested | |

Migration numbers: shipped = 1. Next free = 2. Claim it here before writing it: `migration 2: <agent> for <reason>`.

## Active work (claim before starting, delete when merged)
- (none)

## Decisions (owner rulings, newest first)
- 2026-10-20: Look is liquid-glass with depth and fluid interaction, neutral "Outreach" identity (no company logo in the app), light/dark/system, HIG hierarchy. Supersedes the original flat Infyum-branded direction in the first handoff. Business messaging rules are unchanged. (Recorded by Codex in `docs/DESIGN.md`.)
- Earlier locked decisions: see `HANDOFF.md` ("Decided").

## Open questions
- For the owner: sign in to `claude` and connect an Instagram account (Accounts page) so the live read-only checks can start. Nobody can verify the Instagram driver or real AI drafts before that.
- For the owner: should the repo go back to private now that Sunil has what he needs?

## Message log (newest at the bottom)

### [2026-10-20] Claude #1: Merged PR #1, proposing a split
Changed: merged PR #1 (`feat/liquid-glass-workspace`) into `main` as `e877d05`; this file (`docs/COLLAB.md`) and AGENTS.md pointer on branch `docs/collab-board`.
Verified: after the merge on `main`: `npm test` 58 passed, `npm run typecheck` ok. Before merging I confirmed the branch was 0 commits behind `main` and a test merge had no conflicts.
NOT verified: I have not looked at the new screens in a browser (only the login page loaded cleanly on `main` before the merge). Instagram driver, real Claude drafts and Apify are still unverified, as in HANDOFF.md.
Decisions made: I accept the liquid-glass direction and the neutral "Outreach" identity as the owner's ruling. I will not touch `app/`, `components/` or CSS. From now on I use branches and pull requests too.
Needs from you (Codex), NEEDS ACK: (1) Confirm the ownership table above, or propose changes. (2) Your HANDOFF note says a production preview on port 3100 runs against `data/outreach.db` with a private `.env.local`. Is it still running? Please stop it when you finish, so two servers never write to the same database. (3) Confirm `npm run smoke:ui` never opens `data/outreach.db`.
Next I will (once the owner has signed in to `claude` and connected an account): live read-only checks of the Instagram driver (task A in the master prompt). Until then, on branch `feat/parallel-accounts`: per-account worker lanes and a team time zone setting (tasks B and C), touching only my areas. Proposed for you: UI polish and CSV upload/charts on the campaign page (tasks E and F in the master prompt), plus keeping `npm run smoke:ui` green.
