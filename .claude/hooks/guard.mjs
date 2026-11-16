#!/usr/bin/env node
// PreToolUse guard. Exit code 2 blocks the action and shows the message to Claude.
// Write/Edit: blocks secrets files, generated code, frozen history.
// Bash: blocks `git push` straight to main (GitHub cannot enforce this on a free private repo, so this is the
//       safeguard for Claude sessions; people and other tools are covered by the pull-request rule in AGENTS.md).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // never block on unreadable input
}

const block = (why) => {
  process.stderr.write(`Blocked: ${why}\n`);
  process.exit(2);
};

const PROTECTED = new Set(["main", "master"]);
const EDITING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function currentBranch(cwd) {
  const r = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: cwd || process.cwd(), encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

/** Returns a reason when a shell command would push to main/master, otherwise null. */
function pushToMain(command, cwd) {
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift(); // FOO=1 git push
    if (tokens[0] !== "git") continue; // only a command that starts with git, not prose that mentions it
    const at = tokens.indexOf("push");
    if (at === -1) continue;
    const args = tokens.slice(at + 1);
    if (args.some((a) => a === "--all" || a === "--mirror")) return "`git push --all/--mirror` would update main.";
    const positional = args.filter((a) => !a.startsWith("-")).map((a) => a.replace(/^['"]|['"]$/g, ""));
    const refspecs = positional.slice(1); // positional[0] is the remote
    if (refspecs.length === 0) {
      if (PROTECTED.has(currentBranch(cwd))) return "you are on main and `git push` would push it.";
      continue;
    }
    for (const spec of refspecs) {
      const target = spec.replace(/^\+/, "").split(":").pop().replace(/^refs\/heads\//, "");
      const resolved = target === "HEAD" ? currentBranch(cwd) : target;
      if (PROTECTED.has(resolved)) return `"${spec}" would update ${resolved}.`;
    }
  }
  return null;
}

const tool = input?.tool_name;

if (tool === "Bash") {
  const reason = pushToMain(String(input?.tool_input?.command ?? ""), input?.cwd);
  if (reason) block(`${reason} Push a branch and open a pull request instead (main cannot be protected on this plan, so this rule is the protection).`);
  process.exit(0);
}

// Everything below is about files, and only editing tools change them.
if (tool && !EDITING_TOOLS.has(tool)) process.exit(0);
const target = input?.tool_input?.file_path;
if (typeof target !== "string" || target === "") process.exit(0);

const normalized = target.split(path.sep).join("/");
const base = path.basename(normalized);

if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
  block(`${base} holds secrets. Edit .env.example for documentation, and ask the owner to change real values.`);
}
if (normalized.includes("/node_modules/")) {
  block("node_modules is generated. Change package.json and run npm install instead.");
}
if (normalized.includes("/docs/archive/")) {
  block("docs/archive/ is frozen history. Put current facts in docs/STATUS.md or a decision record.");
}
process.exit(0);
