import type { Db } from "@/lib/db/core";
import { DEFAULT_SESSION_SECRET } from "@/lib/auth/production-secret";
import { budgetSnapshot, billingHold } from "@/lib/billing/budget";
import { activeAiModel, integrationReady, verifiedModelRate } from "@/lib/billing/config";
import { payerFor } from "@/lib/billing/attribution";
import { getSetting } from "@/lib/db/repos/settings";
import { sheetsStatus } from "@/lib/sheets/connection";

export type Check = { area: "App" | "Instagram" | "Claude" | "Apify" | "Google"; status: "ok" | "todo" | "warn"; message: string; fix?: string };
export type ReadinessInput = {
  env: Record<string, string | undefined>;
  db: Db | null;
  fetchImpl: typeof fetch;
  appUp: boolean;
  nowMs: number;
};

const ok = (area: Check["area"], message: string): Check => ({ area, status: "ok", message });
const todo = (area: Check["area"], message: string, fix: string): Check => ({ area, status: "todo", message, fix });
const warn = (area: Check["area"], message: string, fix?: string): Check => ({ area, status: "warn", message, fix });

/** Asks a service whether a key works using a call that costs nothing. Never throws. */
async function probe(fetchImpl: typeof fetch, url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch { return null; }
}

/** Everything that has to be true before the first real run, in plain words. Reads only: nothing is sent, spent or changed. */
export async function evaluateReadiness(input: ReadinessInput): Promise<Check[]> {
  const { env, db, fetchImpl } = input;
  const checks: Check[] = [];
  const dbOnly = <T,>(fn: (db: Db) => T): T | null => { try { return db ? fn(db) : null; } catch { return null; } };

  // ---- the app itself
  checks.push(input.appUp ? ok("App", "The web app is running") : todo("App", "The web app is not running", "npm run restart"));
  checks.push(!env.SESSION_SECRET || env.SESSION_SECRET === DEFAULT_SESSION_SECRET ? todo("App", "SESSION_SECRET is missing or still the default", "put a long random SESSION_SECRET in .env.local") : ok("App", "SESSION_SECRET is set"));
  checks.push(env.HUMAN_PACING === "off" ? warn("App", "Human-speed pacing is switched OFF (Instagram locked the test account when it was off)", "remove HUMAN_PACING=off from .env.local") : ok("App", "Human-speed pacing is on"));
  const killed = dbOnly((d) => getSetting(d, "kill_switch"));
  if (killed) checks.push(warn("App", "Everything is stopped (the Stop everything switch is on)", "press Resume at the top of the app when you want it to run"));

  // ---- Instagram
  const account = dbOnly((d) => d.prepare("SELECT handle, status, daily_cap FROM ig_accounts ORDER BY id LIMIT 1").get() as { handle: string; status: string; daily_cap: number } | undefined);
  if (!account) checks.push(todo("Instagram", "No Instagram account is connected", "Accounts, then Connect your Chrome"));
  else checks.push(account.status === "active" ? ok("Instagram", `@${account.handle} is connected (limit ${account.daily_cap} a day)`) : warn("Instagram", `@${account.handle} is ${account.status}`, "check the Accounts page"));
  const seen = dbOnly((d) => d.prepare("SELECT max(value) v FROM settings WHERE key LIKE 'device_seen_%'").get() as { v: string | null });
  const age = seen?.v ? (input.nowMs - Number(seen.v)) / 1000 : null;
  checks.push(age !== null && age < 60 ? ok("Instagram", "The Chrome extension is online") : warn("Instagram", age === null ? "The Chrome extension has never connected" : `The Chrome extension last checked in ${Math.round(age / 60)} minutes ago`, "open Chrome (it reconnects by itself within about 15 seconds); first time: see docs/GO-LIVE.md"));

  // ---- Claude
  if (env.AI_PROVIDER === "local") checks.push(todo("Claude", "Writing is set to the small local model", "delete the AI_PROVIDER=local line from .env.local, then npm run restart"));
  const key = env.ANTHROPIC_API_KEY;
  if (!key) checks.push(todo("Claude", "No Anthropic API key yet", "add ANTHROPIC_API_KEY=... to .env.local"));
  else {
    const reply = await probe(fetchImpl, "https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" });
    if (!reply) checks.push(warn("Claude", "Could not reach Anthropic to test the key (no internet?)", "try again"));
    else if (reply.status === 401 || reply.status === 403) checks.push(todo("Claude", "Anthropic refused this key", "copy the key again from console.anthropic.com"));
    else if (reply.status !== 200) checks.push(warn("Claude", `Anthropic answered ${reply.status} when testing the key`, "try again in a minute"));
    else {
      const models = ((reply.body as { data?: { id?: string }[] } | null)?.data ?? []).map((m) => m.id);
      const model = db ? dbOnly(activeAiModel) : null;
      checks.push(ok("Claude", "The Anthropic key works"));
      if (model && models.length && !models.includes(model)) checks.push(warn("Claude", `This key does not list the model ${model}`, "check the key's access in console.anthropic.com"));
      checks.push(warn("Claude", "Credit is not checked here: the first drafted message proves it", "if a draft fails with a billing error, add credit at console.anthropic.com"));
    }
  }
  const user = dbOnly((d) => d.prepare("SELECT min(id) id FROM users").get() as { id: number | null });
  if (user?.id && db) {
    const snap = dbOnly((d) => budgetSnapshot(d, user.id!, new Date(input.nowMs).toISOString()));
    const fixClaude = "npm run setup:claude -- --limit 10 --pause-campaigns --yes";
    checks.push(snap && snap.consent && snap.ceilingMicros > 0 ? ok("Claude", `Monthly limit for paid work is set ($${(snap.ceilingMicros / 1_000_000).toFixed(2)})`) : todo("Claude", "No monthly spending limit is set, so paid work is off", fixClaude));
    checks.push(dbOnly(integrationReady) ? ok("Claude", "The metering sign-off is recorded") : todo("Claude", "The metering sign-off is missing, so paid work stays blocked", fixClaude));
    const unpaid = dbOnly((d) => (d.prepare("SELECT id FROM campaigns").all() as { id: number }[]).filter((c) => payerFor(d, "campaign", c.id) !== user.id).length) ?? 0;
    const unpaidAcc = dbOnly((d) => (d.prepare("SELECT id FROM ig_accounts").all() as { id: number }[]).filter((a) => payerFor(d, "account", a.id) !== user.id).length) ?? 0;
    checks.push(unpaid + unpaidAcc === 0 ? ok("Claude", "You are set as the payer for every campaign and account") : todo("Claude", `${unpaid} campaign(s) and ${unpaidAcc} account(s) have no payer`, fixClaude));
    const model = dbOnly(activeAiModel);
    const rateOk = model ? dbOnly((d) => { verifiedModelRate(d, model); return true; }) : null;
    checks.push(rateOk ? ok("Claude", `The price of ${model} is confirmed`) : todo("Claude", `The price of ${model ?? "the model"} is not confirmed`, "ask Claude Code to confirm the model price in Usage and billing"));
    const hold = snap ? dbOnly((d) => billingHold(d, user.id!, new Date(input.nowMs).toISOString())) : null;
    if (hold && snap && snap.consent && snap.ceilingMicros > 0 && dbOnly(integrationReady)) checks.push(warn("Claude", `Paid work is blocked: ${hold}`));
  }

  // ---- Apify
  const apify = env.APIFY_TOKEN;
  if (!apify) checks.push(todo("Apify", "No Apify token yet (needed for Find leads)", "add APIFY_TOKEN=... to .env.local"));
  else {
    const reply = await probe(fetchImpl, "https://api.apify.com/v2/users/me", { authorization: `Bearer ${apify}` });
    if (!reply) checks.push(warn("Apify", "Could not reach Apify to test the token (no internet?)", "try again"));
    else if (reply.status === 401 || reply.status === 403) checks.push(todo("Apify", "Apify refused this token", "copy it again from console.apify.com, Settings, API and Integrations"));
    else if (reply.status !== 200) checks.push(warn("Apify", `Apify answered ${reply.status} when testing the token`, "try again in a minute"));
    else checks.push(ok("Apify", `The Apify token works (${(reply.body as { data?: { username?: string } } | null)?.data?.username ?? "account found"})`));
  }
  const cap = dbOnly((d) => getSetting(d, "apify_monthly_cap_usd"));
  checks.push(cap && Number(cap) > 0 ? ok("Apify", `Lead search limit is $${cap} a month`) : todo("Apify", "No monthly lead-search limit, so Find leads stays off", "npm run setup:claude -- --limit 10 --apify-cap 5 --pause-campaigns --yes (or Settings, Lead search)"));

  // ---- Google
  const id = env.GOOGLE_CLIENT_ID, secret = env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) checks.push(todo("Google", "Google client id and secret are missing (for the Sheet and Google sign-in)", "add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local"));
  else {
    checks.push(/\.apps\.googleusercontent\.com$/.test(id) ? ok("Google", "Google client id and secret are set") : warn("Google", "The Google client id does not look right (it should end in .apps.googleusercontent.com)", "copy it again from Google Cloud, Credentials"));
    const origin = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    checks.push(warn("Google", `In Google Cloud, these two redirect addresses must be added to that client: ${origin}/api/auth/google/callback and ${origin}/api/sheets/google/callback (this cannot be checked from here)`));
  }
  const sheets = dbOnly(sheetsStatus);
  checks.push(sheets?.connected ? ok("Google", sheets.sheetId ? "Google Sheets is connected and a Sheet is chosen" : "Google Sheets is connected but no Sheet is chosen yet") : todo("Google", "Google Sheets is not connected", "Settings, Google Sheet, Connect Google Sheets, then Create the Sheet"));
  if (sheets?.error) checks.push(warn("Google", `The last Sheet sync failed: ${sheets.error}`));
  return checks;
}
