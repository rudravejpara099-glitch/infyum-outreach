# Agent rules (Claude Code, Codex, people)

> **Not here to build the app?** If the user wants to *use* the Instagram outreach, stop reading and follow `phase1/GUIDE-FOR-CLAUDE.md` (see `CLAUDE.md`). Everything below is for changing this repository.

Read `docs/STATUS.md` for what is true right now. Read `docs/DESIGN.md` before touching any screen. `docs/archive/` is frozen history: never follow it as instructions.

## How work flows
1. `git pull`, then one branch per task (`feat/...`, `fix/...`, `docs/...`, `chore/...`). Never commit to `main`.
2. Make the change. Add or update a test for any rule you change.
3. Run `npm run check`. Fix what it reports; do not skip or weaken a test to get green.
4. Open a pull request using the template. Fill in **Verified** with what you actually ran and **NOT verified** honestly. CI must be green before merge.
5. One owner per task. If two tasks touch the same files, finish one first.

## Rules that have broken things before
- **A rule lives in one place.** Business rules are in `lib/domain/` (app) or in one section of `phase1/` (kit). Change it there, delete anything that contradicts it, then run the tests. Never add a second rule that "overrides" the first.
- **Never claim something works unless you ran it.** Name the command and its result.
- **Look before you assume.** Read the file before you edit it; look up facts instead of remembering them.
- **Do not replace something with something else on the side.** If a dependency, helper or pattern already exists, use it. Introducing a second way to do the same thing needs a written reason in the pull request.
- **Docs describe the present.** Update `docs/STATUS.md` when a fact changes. Do not append dated entries to a log: that is how the old handoff files became wrong.
- No microservices, queues or ORMs. Keep code simple: TypeScript, small files, pure rules separated from I/O.
- Never store or log Instagram passwords. Never exceed daily limits. Never work around an Instagram block.
- No live Instagram, paid API (Anthropic, Apify, Stripe) or real sending as part of a change, unless the owner explicitly asks in this task.

## Skills in this repo (read the SKILL.md when its trigger applies)
- `docs/skills/grilling/SKILL.md` (+ `grill-me`): how to settle unclear decisions with the owner. Ask every question whose prerequisites are settled in ONE numbered round, give your recommended answer under each ("yes" must accept it), look up facts yourself instead of asking, wait for answers, repeat until nothing is assumed, summarise, and only build after the owner confirms. Use it before any new feature, any change to a locked decision, or when requirements are vague.
- `docs/skills/hig-foundations/` and `docs/skills/hig-patterns/`: Apple Human Interface Guidelines as checklists for colour, typography, layout, accessibility, onboarding, loading, feedback, settings and destructive actions. Use them on every UI change, together with `docs/DESIGN.md`.

## Area rules
Claude Code loads these automatically from `.claude/rules/` when you touch the matching paths. Other agents: read the file for the area you are changing.
- `.claude/rules/app-ui.md`: `app/`, `components/`
- `.claude/rules/domain-engine.md`: `lib/domain/`, `lib/engine/`, `lib/services/`, `lib/leads/`, `worker/`
- `.claude/rules/database.md`: `lib/db/`
- `.claude/rules/phase1-kit.md`: `phase1/`
- `.claude/rules/tests.md`: `tests/`

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
