#!/usr/bin/env node
// PreToolUse guard for Write/Edit. Exit code 2 blocks the edit and shows the message to Claude.
// Blocks: secrets files, frozen history, dependencies.
import { readFileSync } from "node:fs";
import path from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // never block on unreadable input
}

const target = input?.tool_input?.file_path;
if (typeof target !== "string" || target === "") process.exit(0);

const normalized = target.split(path.sep).join("/");
const base = path.basename(normalized);

const block = (why) => {
  process.stderr.write(`Blocked: ${why}\n`);
  process.exit(2);
};

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
