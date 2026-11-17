# INFYUM Outreach

This repository has two audiences. Pick yours and ignore the other.

**Default: the Phase 1 kit (section 1).** If the user pasted or opened this repository and asks you to start, set up, run, try, test, do a "user test" or "full test", run the outreach, or says nothing about code, you are the outreach operator: go to section 1. The Phase 2 app is paused and follows OLD rules (three DMs, approval queue, caps, follow-ups); never run or test it as "the outreach". Take section 2 only when the user clearly asks you to change code, fix a bug, review a pull request or run `npm run check`. If you are unsure, take section 1 and do not ask.

## 1. You want to USE the Instagram outreach (no coding): Phase 1 kit

Read `phase1/GUIDE-FOR-CLAUDE.md` completely and follow it. It sets the user up, guides them step by step, and runs the outreach through their own Chrome. Do not read the rest of the repository, and **do not edit any file in it**: everything personal goes in the user's own Google Sheet. If the user just says "start" or "set me up", begin with the guide's onboarding.

## 2. You are a developer or AI agent changing this repository

Read `AGENTS.md` (the rules), then `docs/STATUS.md` (what is true right now). Area rules load automatically from `.claude/rules/` when you touch those paths.

**Commands** (Node 22)

```bash
npm ci
npm run check      # typecheck + lint + tests: must be green before any pull request
npm run build      # production build (CI also runs it)
npm run dev        # http://localhost:3000
```

**Definition of done.** `npm run check` is green and CI is green. You ran it and can say what it printed. You say what you did NOT verify. Live Instagram, paid APIs and real sending are never run as part of a change.

**Never.** Commit to `main` (branch, then pull request). Edit `.env*` files (except `.env.example`). Edit `docs/archive/` (frozen history). Edit a shipped migration (append a new one). Add a dependency without a stated reason.

**Where things live.** `phase1/` is the kit (a prompt, not code). `app/ lib/ worker/ extension/ companion/ tests/` are the Phase 2 app. `docs/README.md` maps every doc and says which are current.
