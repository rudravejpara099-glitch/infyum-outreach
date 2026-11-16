# 0003: The kit is the product, Phase 2 is paused, and `main` stays unprotected

Date: 2026-11-16 · Status: decided by the owner (a structured question round), recorded in pull request `chore/main-safeguards`

## Context
After the repo clean-up (decisions 0001 and 0002) several things were still open: the Phase 2 app and the Phase 1 kit write different first messages; PR #96 (96 files, conflicting, 12 days old) was stuck; the public address was down; and GitHub cannot protect `main` on a free private repo.

## Decisions
1. **The Phase 1 kit is the product; the Phase 2 app is paused.** The app stays working with tests green and gets no new features. PR #96 is closed with its branch kept. Resume only on the owner's say-so.
2. **The kit's message rules win.** The app's engine still writes exactly three DMs with the link in message 2 plus up to two follow-ups (`lib/engine/prompts.ts`, `validate.ts`); the kit sends one to three messages and stops after the first. When Phase 2 resumes, rewrite the engine to match the kit. PR #96 contains a kit-style writer to start from. No app code changed now.
3. **No paid GitHub plan.** `main` stays technically unprotected, and the owner accepts that. Safeguards: a Claude Code hook that blocks `git push` to `main`, the pull-request rule, and CI reporting on every PR. The hook covers Claude sessions only.
4. **The public address stays off.** The `*.trycloudflare.com` wildcard is removed from the Server Actions allowlist. A per-address login throttle and a script CSP are deferred until it returns (checklist in `docs/STATUS.md`).

## Consequences
- Anyone with write access, or another tool, can still push straight to `main`. The cost of one bad push is a revert; CI will show red after the fact.
- Message-rule changes go to the kit (guide, `kit:check`, `kit:lock`), not to the app.
- Revisit decision 3 if more people get write access or the repo becomes public.
