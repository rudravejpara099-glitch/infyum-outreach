/** Disposable full-stack simulator checks. No real Stripe, AI, Apify or worker. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { openDb } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { createAccount } from "@/lib/db/repos/accounts";
import { claimResource } from "@/lib/billing/attribution";
import { saveCeiling } from "@/lib/billing/config";
import { saveModelRate } from "@/lib/billing/admin";
import { reserveUsage, settleUsage } from "@/lib/billing/budget";
import { tokenEvent } from "@/lib/billing/ledger";
import { periodFor } from "@/lib/billing/periods";
import { addResourceCost } from "@/lib/billing/resources";
import { syncBilling } from "@/lib/billing/sync";
import { setSetting } from "@/lib/db/repos/settings";
import { createUser } from "@/lib/db/repos/users";
import { createWorkspaceSession } from "@/lib/workspaces/catalog";
import { billingTestProvider } from "./billing-test-provider";
import { buildIsolatedNextApp, cleanupIsolatedNextApp, type IsolatedNextBuild } from "./isolated-next-build";
async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}
async function main() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "outreach-billing-")), dbPath = path.join(temp, "billing.db");
  const screenshots = path.resolve("data/billing-smoke"); mkdirSync(screenshots, { recursive: true });
  const base = "http://127.0.0.1:3191", secret = `whsec_${randomBytes(24).toString("hex")}`;
  const provider = await billingTestProvider(base, secret);
  const sessionSecret = randomBytes(48).toString("hex");
  let build: IsolatedNextBuild | undefined;
  let serverOutput = "";
  let server: ChildProcess | undefined;
  const startServer = (isolatedBuild: IsolatedNextBuild) => {
    serverOutput = "";
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3191"], {
      env: { ...process.env, NODE_ENV: "production", OUTREACH_SMOKE_MODE: "1", OUTREACH_SMOKE_DIST_DIR: isolatedBuild.distDir, OUTREACH_SMOKE_TSCONFIG: isolatedBuild.tsconfigPath, DB_PATH: dbPath, PROFILES_DIR: path.join(temp, "profiles"), SESSION_SECRET: sessionSecret, BILLING_OWNER_USER_ID: "1", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: secret, BILLING_TEST_API_BASE: provider.origin, APP_URL: base, APIFY_TOKEN: "fixture-only" }, stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-4000); };
    child.stdout?.on("data", capture); child.stderr?.on("data", capture);
    return child;
  };
  const serverStartError = () => new Error(`Billing review server did not start${serverOutput ? `:\n${serverOutput.replaceAll(sessionSecret, "[redacted]").replaceAll(secret, "[redacted]").replaceAll("fixture-only", "[redacted]").replaceAll(temp, "[temporary smoke directory]").trim()}` : ""}`);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let db: ReturnType<typeof openDb> | undefined;
  try {
    build = buildIsolatedNextApp("billing", [sessionSecret, secret, "fixture-only", "sk_test_fixture"]);
    server = startServer(build);
    let ready = false;
    const startupDeadline = Date.now() + 45_000;
    while (!ready && Date.now() < startupDeadline) {
      if (!server || server.exitCode !== null) throw serverStartError();
      const controller = new AbortController();
      const requestTimeout = setTimeout(() => controller.abort(), 1_000);
      try { if ((await fetch(`${base}/setup`, { signal: controller.signal })).ok) ready = true; } catch { /* server is starting */ }
      finally { clearTimeout(requestTimeout); }
      if (ready) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw serverStartError();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/setup`);
    await page.getByLabel("Your name").fill("Billing review"); await page.getByLabel("Email", { exact: true }).fill("billing@example.test");
    await page.getByLabel("Password", { exact: true }).fill(randomBytes(24).toString("hex"));
    await page.getByRole("button", { name: "Create account", exact: true }).click(); await page.waitForURL(base + "/");
    await page.goto(`${base}/billing`); await page.getByRole("heading", { name: "Usage and billing", exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshots, "empty.png"), fullPage: true, caret: "initial" });
    assert.equal((await page.getByText("No recorded usage yet.", { exact: false }).count()), 1);
    assert.equal((await fetch(`${base}/api/billing/webhook`, { method: "POST", body: "{}" })).status, 400);
    db = openDb(dbPath);
    const now = new Date().toISOString(), current = periodFor(now).start + "T00:00:00.000Z";
    const previous = periodFor(new Date(Date.parse(current) - 86400000).toISOString()).start + "T00:00:00.000Z";
    process.env.BILLING_OWNER_USER_ID = "1";
    saveCeiling(db, 1, 200000000, previous);
    db.prepare("INSERT INTO billing_integration_ack VALUES(1,'local-fixture-only','simulated-worker',?)").run(previous);
    saveModelRate(db, 1, { model: "fixture-model", inputMicros: 3000000, outputMicros: 15000000, cacheReadMicros: null, cacheWriteMicros: null, source: "https://provider.example.test/prices", confirmed: true }, previous);
    const campaign = createCampaign(db, { name: "Billing test campaign", niches: [], country: "United States", minFollowers: 2000, maxFollowers: 150000, audienceText: "Only disposable test data", approvalRequired: true, followupsEnabled: false }, [], "fixture");
    const account = createAccount(db, { handle: "billing.fixture", profileDir: path.join(temp, "unused") }, "fixture");
    db.prepare("INSERT INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)").run(campaign.id, account.id);
    claimResource(db, 1, "campaign", campaign.id, previous); claimResource(db, 1, "account", account.id, previous);
    setSetting(db, "apify_monthly_cap_usd", "5");
    addResourceCost(db, 1, { userId: 1, accountId: account.id, kind: "proxy_share", amountMicros: 10000000, reference: "simulated-provider-invoice" }, previous);
    for (const [operation, when, settleAt] of [["past-ai", previous, previous], ["current-ai", current, now]]) {
      const source = { campaignId: campaign.id, accountId: account.id };
      const reservation = reserveUsage(db, { userId: 1, operationId: operation, provider: "ai", model: "fixture-model", maxCostMicros: 1000000, source, now: when });
      settleUsage(db, operation, [tokenEvent(db, { userId: 1, eventKey: `${operation}:input`, occurredAt: settleAt, model: "fixture-model", rateId: reservation.rate_id!, category: "input", tokens: 100000, providerRef: `req-${operation}`, source }), tokenEvent(db, { userId: 1, eventKey: `${operation}:output`, occurredAt: settleAt, model: "fixture-model", rateId: reservation.rate_id!, category: "output", tokens: 22000, providerRef: `req-${operation}`, source })], settleAt);
    }
    syncBilling(db, 1, now);
    const statement = db.prepare("SELECT id,total_cents FROM billing_statements WHERE user_id=1 AND total_cents>0 ORDER BY id LIMIT 1").get() as { id: number; total_cents: number };
    assert(statement);
    db.prepare("DELETE FROM billing_integration_ack WHERE id=1").run();
    await page.goto(`${base}/campaigns/${campaign.id}`);
    await page.getByRole("button", { name: "Start campaign", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "paused until the metered worker integration is reviewed" }).waitFor();
    assert.equal((db.prepare("SELECT status FROM campaigns WHERE id=?").get(campaign.id) as { status: string }).status, "draft");
    // Model an already-active campaign after its billing integration acknowledgement is removed.
    db.prepare("UPDATE campaigns SET status='active' WHERE id=?").run(campaign.id);
    await page.reload();
    await page.locator("#add-leads").evaluate((element: HTMLDetailsElement) => { element.open = true; });
    await page.getByRole("button", { name: "Queue lead search", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "paused until the metered worker integration is reviewed" }).waitFor();
    assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='find_leads'").get() as { n: number }).n, 0);
    db.prepare("INSERT INTO billing_integration_ack VALUES(1,'local-fixture-only','simulated-worker',?)").run(previous);
    await page.goto(`${base}/billing`);
    await page.getByLabel("Monthly spending ceiling (USD)").fill("250");
    await page.getByRole("button", { name: "Save spending limit" }).click();
    await page.getByRole("status").filter({ hasText: "Spending limit saved" }).waitFor();
    assert.equal((db.prepare("SELECT ceiling_micros FROM billing_profiles WHERE user_id=1").get() as { ceiling_micros: number }).ceiling_micros, 250000000);
    for (const mode of ["light", "dark"] as const) {
      await page.getByRole("button", { name: `Use ${mode} appearance` }).click();
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const route of ["/billing", "/billing/admin", `/billing/statements/${statement.id}`]) {
          await page.goto(base + route); await page.locator("h1").waitFor();
          if (route === "/billing") await page.getByText("Only actual costs are passed through. There is no service margin.", { exact: true }).waitFor();
          if (route === "/billing/admin") {
            assert.equal(await page.getByLabel("markup_percent").count(), 0, "Owner settings must not expose a markup control");
            assert.equal(await page.getByText(/service margin/i).count(), 0, "Owner settings must not describe a service margin");
            if (mode === "light" && width === 1440) {
              const modelPicker = page.getByLabel("AI model for new drafts");
              await modelPicker.selectOption("fixture-model");
              await page.getByRole("button", { name: "Save AI model", exact: true }).click();
              await page.getByRole("status").filter({ hasText: "New metered drafts will use fixture-model" }).waitFor();
              assert.equal((db.prepare("SELECT value FROM settings WHERE key='anthropic_model'").get() as { value: string }).value, "fixture-model");
            }
          }
          if (route.startsWith("/billing/statements/")) assert.equal(await page.getByText(/service margin/i).count(), 0, "Statements must not add a service margin");
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${route} ${width} ${mode}`);
          await page.screenshot({ path: path.join(screenshots, `${route.slice(1).replaceAll("/", "-")}-${mode}-${width}.png`), fullPage: true, caret: "initial" });
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/billing/statements/${statement.id}`);
    await page.getByRole("button", { name: /in test checkout/ }).click();
    await page.waitForURL(provider.origin + "/checkout/**");
    await page.getByRole("button", { name: "Decline simulated payment" }).click();
    await page.waitForURL(`${base}/billing/statements/${statement.id}?checkout=cancelled`);
    assert.equal((db.prepare("SELECT count(*) n FROM billing_payments").get() as { n: number }).n, 0);
    await page.getByRole("button", { name: /in test checkout/ }).click(); await page.waitForURL(provider.origin + "/checkout/**");
    await page.getByRole("button", { name: "Confirm simulated payment" }).click();
    await page.waitForURL(`${base}/billing/statements/${statement.id}?checkout=returned`);
    await page.getByText("Paid", { exact: true }).waitFor();
    assert.equal(provider.sessions(), 1); assert.equal(provider.deliveries(), 4);
    assert.equal((db.prepare("SELECT count(*) n FROM billing_payments").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT count(*) n FROM billing_fee_reconciliations").get() as { n: number }).n, 1);
    const response = await context.request.get(`${base}/billing/export`); assert.equal(response.status(), 200); assert((await response.text()).includes("provider_reference"));
    const identity = openDb(`${dbPath}.identity.db`);
    let otherId: number, otherSession: string;
    try {
      otherId = createUser(identity, "other@example.test", "Other", "unused").id;
      identity.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ('legacy',?,'member')").run(otherId);
      otherSession = createWorkspaceSession(identity, otherId, "legacy", Date.now() + 3_600_000);
    } finally { identity.close(); }
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ uid: otherId, wid: "legacy", sid: otherSession }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(sessionSecret));
    const otherContext = await browser.newContext();
    await otherContext.addCookies([{ name: "session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const otherPage = await otherContext.newPage();
    await otherPage.goto(`${base}/billing/admin`); await otherPage.getByRole("heading", { name: "404", exact: true }).waitFor();
    await otherPage.goto(`${base}/billing/statements/${statement.id}`); await otherPage.getByRole("heading", { name: "404", exact: true }).waitFor();
    assert.equal((await otherContext.request.get(`${base}/billing/statements/${statement.id}/export`)).status(), 404);
    const otherCsv = await otherContext.request.get(`${base}/billing/export`); assert.equal(otherCsv.status(), 200); assert(!(await otherCsv.text()).includes("req-current-ai"));
    await otherContext.close();
    await page.getByRole("button", { name: "Sign out", exact: true }).click(); await page.waitForURL(`${base}/login`);
    assert.equal((await fetch(`${base}/billing/admin`, { redirect: "manual" })).status, 307);
    assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE status='sent' AND direction='out'").get() as { n: number }).n, 0);
    assert.deepEqual(errors, []);
    console.log("Billing simulator smoke passed: isolated data, six responsive/theme sizes, owner UI, consent/limit save, hosted redirect, declined and paid sessions, signed duplicate webhooks, exact payment and fee reconciliation, CSV, other-user admin/statement/export rejection, and signed-out protection. LOCAL SIMULATOR ONLY; actual Stripe TEST account not verified.");
  } finally {
    db?.close(); await browser?.close(); if (server) await stopServer(server); await provider.close(); if (build) cleanupIsolatedNextApp(build); rmSync(temp, { recursive: true, force: true }); delete process.env.BILLING_OWNER_USER_ID;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
