// The Claude Code guard (.claude/hooks/guard.mjs). GitHub cannot protect main on a free private repo, so this
// hook is the safeguard for Claude sessions: it must block a push to main and must never block normal work.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const guard = path.join(process.cwd(), ".claude/hooks/guard.mjs");
const run = (input: unknown) => spawnSync(process.execPath, [guard], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" });
const bash = (command: string, cwd?: string) => run({ tool_name: "Bash", tool_input: { command }, cwd });
const edit = (file_path: string) => run({ tool_name: "Edit", tool_input: { file_path } });

let onMain: string, onFeature: string;
beforeAll(() => {
  const make = (branch: string) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "guard-"));
    spawnSync("git", ["init", "-q", "-b", branch], { cwd: dir });
    return dir;
  };
  onMain = make("main");
  onFeature = make("feature/x");
});
afterAll(() => { rmSync(onMain, { recursive: true, force: true }); rmSync(onFeature, { recursive: true, force: true }); });

describe("pushes to main are blocked", () => {
  it.each([
    "git push origin main",
    "git push -u origin main",
    "git push origin HEAD:main",
    "git push origin +main",
    "git push origin refs/heads/main",
    "git push origin feature:main",
    "git push origin master",
    "git push --force origin main",
    "git push origin --delete main",
    "git push --all",
    "git push --mirror origin",
    "git -c credential.helper= push origin main",
    "echo start && git push origin main",
    "git fetch; git push origin main",
    "GIT_TERMINAL_PROMPT=0 git push origin main",
  ])("blocks: %s", (command) => {
    const result = bash(command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("pull request");
  });

  it("blocks a bare `git push` and `git push origin HEAD` when the current branch is main", () => {
    expect(bash("git push", onMain).status).toBe(2);
    expect(bash("git push origin", onMain).status).toBe(2);
    expect(bash("git push origin HEAD", onMain).status).toBe(2);
  });
});

describe("normal work is never blocked", () => {
  it.each([
    "git push -u origin fix/something",
    "git push origin chore/kit-checks",
    "git push --force-with-lease origin chore/kit-checks",
    "git push origin HEAD:refs/heads/feature/x",
    "git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin fix/close-registration",
    "git status",
    "git log --oneline origin/main",
    "git merge --ff-only origin/main",
    "gh pr merge 105 --squash",
    "npm run check",
    "echo 'to avoid the problem never run git push origin main'",
    "- the guard that blocks git push to main",
    "git commit -m 'push to main is blocked'",
    "git push-notes",
  ])("allows: %s", (command) => {
    expect(bash(command).status, command).toBe(0);
  });

  it("allows a bare `git push` and `git push origin HEAD` on a feature branch", () => {
    expect(bash("git push", onFeature).status).toBe(0);
    expect(bash("git push origin HEAD", onFeature).status).toBe(0);
  });

  it("never blocks on unreadable input or unknown tools", () => {
    expect(run("not json").status).toBe(0);
    expect(run({ tool_name: "Read", tool_input: { file_path: "/x/.env.local" } }).status).toBe(0);
  });
});

describe("file guards still work", () => {
  it("blocks secrets, node_modules and the archive, and allows normal files", () => {
    expect(edit("/x/.env.local").status).toBe(2);
    expect(edit("/x/node_modules/a.js").status).toBe(2);
    expect(edit("/x/docs/archive/HANDOFF.md").status).toBe(2);
    expect(edit("/x/.env.example").status).toBe(0);
    expect(edit("/x/lib/a.ts").status).toBe(0);
  });
});
