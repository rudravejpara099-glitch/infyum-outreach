# Start here
Read `HANDOFF.md` first: product rules, decisions, what is built, what is untested, and the next tasks.
Then read `docs/DESIGN.md` before touching any screen.

**Two AI agents (Claude Code and Codex) and the owner share this repo.** Before any work read `docs/COLLAB.md` (rules, who owns which folders, active claims, message log) and `git pull`. Work on a branch, never on `main`. When you stop, add an entry to the log in the format given there, saying what you changed, what you verified, what you did NOT verify, and what you need from the other agent.

## Skills in this repo (read the SKILL.md when its trigger applies)
- `docs/skills/grilling/SKILL.md` (+ `grill-me`): how to settle unclear decisions with the owner. Ask every question whose prerequisites are settled in ONE numbered round, give your recommended answer under each ("yes" must accept it), look up facts yourself instead of asking, wait for answers, repeat until nothing is assumed, summarise, and only build after the owner confirms. Use it before any new feature, any change to a locked decision, or when requirements are vague.
- `docs/skills/hig-foundations/` and `docs/skills/hig-patterns/`: Apple Human Interface Guidelines as checklists for colour, typography, layout, accessibility, onboarding, loading, feedback, settings and destructive actions. Use them on every UI change, together with `docs/DESIGN.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
