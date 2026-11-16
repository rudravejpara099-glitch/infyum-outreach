// Run with: npm run kit:lock -- "what changed and why"
// Records an intentional change to phase1/GUIDE-FOR-CLAUDE.md: bumps the version, stores the file's hash in
// docs/kit-lock.json and adds an entry to docs/kit-changelog.md. tests/phase1-kit.test.ts fails until you do.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { nextVersion, sha256 } from "./kit-lib";

const GUIDE = "phase1/GUIDE-FOR-CLAUDE.md";
const LOCK = "docs/kit-lock.json";
const LOG = "docs/kit-changelog.md";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error('Usage: npm run kit:lock -- "what changed and why"');
  process.exit(1);
}

const previous: { version: string; sha256: string } | null = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : null;
const hash = sha256(readFileSync(GUIDE, "utf8"));
if (previous && previous.sha256 === hash) {
  console.log("The guide has not changed since the last lock. Nothing to record.");
  process.exit(0);
}

const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the local time zone
const version = nextVersion(previous?.version ?? null, today);
writeFileSync(LOCK, JSON.stringify({ version, sha256: hash }, null, 2) + "\n");

const intro = `# Phase 1 kit changelog

Every change to \`phase1/GUIDE-FOR-CLAUDE.md\`, newest first. Added by \`npm run kit:lock\`; do not edit by hand.
`;
const existing = existsSync(LOG) ? readFileSync(LOG, "utf8") : intro;
const entry = `\n## ${version}\n\n${message}\n`;
const firstEntry = existing.indexOf("\n## ");
const next = firstEntry === -1 ? existing.trimEnd() + "\n" + entry : existing.slice(0, firstEntry) + entry + existing.slice(firstEntry);
writeFileSync(LOG, next);

console.log(`Locked kit version ${version}.`);
