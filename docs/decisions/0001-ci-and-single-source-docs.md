# 0001: CI as the gate, and docs that describe the present

Date: 2026-11-16 · Status: proposed in pull request `chore/repo-structure`, pending owner review

## Problem
Work kept breaking things that had worked: steps were forgotten, one tool was swapped for another, fixes caused new failures. An audit found the code itself was healthy (typecheck, lint and 671 tests pass on `main`). The causes were process:
- No CI. "Tests must pass before a pull request" depended on every agent remembering it.
- `HANDOFF.md` (1,338 lines) and `docs/COLLAB.md` (1,588 lines) were append-only logs. They went stale and contradicted current scope and each other (for example "52 tests" when there were 671; three DMs plus follow-ups when the scope is now one first message).
- The 414-line Phase 1 guide was patched 18 times in 30 days with no check that earlier behaviour survived.

## Decision
1. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on every pull request and on `main`. `npm run check` is the same gate locally.
2. Docs describe the present. `docs/STATUS.md` is edited in place. The old logs are frozen in `docs/archive/` with a banner, and a hook blocks edits to them.
3. The Claude/Codex message board is retired. Pull requests (template with **Verified** and **NOT verified**) replace it. Area guidance moves to `AGENTS.md` and `.claude/rules/`.
4. Edits to the kit follow `.claude/rules/phase1-kit.md`: edit in place, never append patches.

## Consequences
- More friction per change, less breakage across changes.
- The old per-folder ownership table is gone. `.github/CODEOWNERS` currently names only the owner.
- Still open: automated checks for the kit, stale-branch cleanup and branch protection on `main`.
