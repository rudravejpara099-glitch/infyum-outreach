---
paths:
  - "lib/domain/**"
  - "lib/engine/**"
  - "lib/services/**"
  - "lib/leads/**"
  - "worker/**"
---

# Rules, engine and worker

- Change a rule in `lib/domain/` first, add or update its test in `tests/`, run `npm test`, and only then look at a screen.
- Pure rules stay separate from I/O. A rule in `lib/domain/` takes plain values and returns a result; it does not read the database or the network.
- The worker and scripts run with `tsx` and import `@/` aliases. Do not import `server-only` modules from the worker: use `lib/db/core.ts`, not `lib/db/index.ts`.
- Message-writing rules live in `lib/engine/prompts.ts` and `lib/engine/validate.ts`. One rule, one place. If the Phase 1 kit and the app disagree on a message rule, stop and ask the owner which is current; do not pick one silently.
- Never exceed an account's daily limit (`lib/config.ts`). The worker stops an account the moment Instagram shows a warning or a human check. Never work around a block.
- Never run live Instagram, Anthropic, Apify or Stripe calls as part of a change. Tests use fakes.
