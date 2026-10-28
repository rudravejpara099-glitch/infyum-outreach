#!/usr/bin/env node
// Finds Instagram accounts for a search phrase using the user's own Apify account (free plan is enough).
// Zero dependencies, Node 18+. The token is read from the environment or from ~/INFYUM-Phase1/.env and is never printed.
//
//   node ~/INFYUM-Phase1/tools/apify-search.mjs "business coach" --limit 20 --max-usd 0.10
//
// Output: one JSON object per line: username, followers, bio, isPrivate, isVerified, url.
// Claude applies the prospect rules (see phase1/GUIDE-FOR-CLAUDE.md); this tool only searches.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const term = args.find((a) => !a.startsWith("--") && !/^\d/.test(a));
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
if (!term) { console.error('Usage: node apify-search.mjs "search phrase" [--limit 20] [--max-usd 0.10]'); process.exit(2); }

const limit = Math.min(50, Math.max(1, Number.parseInt(flag("limit", "20"), 10) || 20));
const maxUsd = Math.min(1, Math.max(0.01, Number.parseFloat(flag("max-usd", "0.10")) || 0.1));

function token() {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN.trim();
  try {
    const line = readFileSync(join(homedir(), "INFYUM-Phase1", ".env"), "utf8").split(/\r?\n/).find((l) => /^APIFY_TOKEN=/.test(l));
    if (line) return line.slice("APIFY_TOKEN=".length).trim();
  } catch { /* no file */ }
  return "";
}
const key = token();
if (!key) { console.error("No Apify token found. Save it as APIFY_TOKEN=... in ~/INFYUM-Phase1/.env (never paste it into the chat)."); process.exit(3); }

// maxTotalChargeUsd is enforced by Apify itself, so a run can never cost more than this.
const url = `https://api.apify.com/v2/acts/apify~instagram-search-scraper/run-sync-get-dataset-items?${new URLSearchParams({ maxTotalChargeUsd: String(maxUsd), timeout: "120", format: "json" })}`;
const response = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ search: term, searchType: "user", searchLimit: limit, resultsLimit: limit }),
});
if (response.status === 401 || response.status === 403) { console.error("Apify rejected the token. Create a new one in Apify, Settings, API & Integrations."); process.exit(4); }
if (!response.ok) { console.error(`Apify could not run the search (HTTP ${response.status}).`); process.exit(5); }
const items = await response.json();
if (!Array.isArray(items)) { console.error("Apify returned an unexpected answer."); process.exit(6); }

for (const item of items) {
  const username = item.username ?? item.ownerUsername ?? item.handle;
  if (typeof username !== "string" || !/^[A-Za-z0-9._]+$/.test(username)) continue;
  console.log(JSON.stringify({
    username: username.toLowerCase(),
    followers: item.followersCount ?? item.followers_count ?? item.followers ?? null,
    bio: String(item.biography ?? item.bio ?? "").replace(/\s+/g, " ").slice(0, 300),
    isPrivate: item.private ?? item.isPrivate ?? item.is_private ?? null,
    isVerified: item.verified ?? item.isVerified ?? null,
    url: `https://www.instagram.com/${username}/`,
  }));
}
console.error(`Found ${items.length} account(s). Spending is capped at $${maxUsd.toFixed(2)} for this search.`);
