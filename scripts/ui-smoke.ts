/** Local-only UI smoke test. Own database, no worker, no Instagram or Apify calls. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { openDb } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignAccounts, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { createOutgoing } from "@/lib/db/repos/messages";
import { addLead, listLeads } from "@/lib/db/repos/leads";
import { addDnc, removeDnc } from "@/lib/db/repos/dnc";
import { buildIsolatedNextApp, cleanupIsolatedNextApp, type IsolatedNextBuild } from "./isolated-next-build";

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

async function screenshot(page: Page, options: Parameters<Page["screenshot"]>[0]) {
  if (process.env.UI_SMOKE_SCREENSHOTS === "0") return;
  await page.screenshot(options);
}

async function tryLoad(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try { return await fetch(url, { signal: controller.signal }); }
  catch { return null; }
  finally { clearTimeout(timer); }
}

async function main() {
const temp = mkdtempSync(path.join(os.tmpdir(), "outreach-ui-"));
const dbPath = path.join(temp, "review.db");
const screenshots = path.resolve(process.env.UI_SCREENSHOT_DIR ?? "data/ui-smoke");
const port = 3190;
const base = `http://127.0.0.1:${port}`;
mkdirSync(screenshots, { recursive: true });
const sessionSecret = randomBytes(48).toString("hex");
let serverOutput = "";
const startServer = (build: IsolatedNextBuild, apifyToken = "") => {
  serverOutput = "";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", OUTREACH_SMOKE_MODE: "1", OUTREACH_SMOKE_DIST_DIR: build.distDir, OUTREACH_SMOKE_TSCONFIG: build.tsconfigPath, APIFY_TOKEN: apifyToken, DB_PATH: dbPath, PROFILES_DIR: path.join(temp, "profiles"), SESSION_SECRET: sessionSecret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-4000); };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return child;
};
const serverStartError = (name: string) => {
  const diagnostic = serverOutput
    .replaceAll(sessionSecret, "[redacted]")
    .replaceAll(temp, "[temporary smoke directory]")
    .replaceAll("fixture-apify-token-never-used", "[redacted]")
    .trim();
  return new Error(`${name}${diagnostic ? `:\n${diagnostic}` : ""}`);
};
let build: IsolatedNextBuild | undefined;
let server: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  build = buildIsolatedNextApp("ui", [sessionSecret]);
  server = startServer(build);
  let ready = false;
  const startupDeadline = Date.now() + 45_000;
  while (!ready && Date.now() < startupDeadline) {
    if (!server || server.exitCode !== null) throw serverStartError("Review server exited before starting");
    if ((await tryLoad(`${base}/setup`))?.ok) ready = true;
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw serverStartError("Review server did not start");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  const errors: string[] = [];
  let expectedServerRestart = false;
  page.on("pageerror", error => {
    if (expectedServerRestart && error.message === "WebSocket is already in CLOSING or CLOSED state.") return;
    errors.push(error.message);
  });
  page.on("console", message => {
    const text = message.text();
    const expectedRestartFailure = expectedServerRestart && (
      /Failed to load resource: net::ERR_(?:CONNECTION_REFUSED|INCOMPLETE_CHUNKED_ENCODING)/.test(text)
      || (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation"))
    );
    if (message.type() === "error" && !expectedRestartFailure) errors.push(message.text());
  });
  const password = randomBytes(24).toString("hex"); // Never persisted or printed.
  await page.goto(`${base}/setup`);
  await page.getByLabel("Your name").fill("UI Review");
  await page.getByLabel("Email", { exact: true }).fill("review@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Your name").fill("   ");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Enter your name" }).waitFor().catch(async error => {
    const nameState = await page.getByLabel("Your name").evaluate((element: HTMLInputElement) => ({ length: element.value.length, valid: element.validity.valid, valueMissing: element.validity.valueMissing, validationMessage: element.validationMessage }));
    console.log(JSON.stringify({ setupValidation: { url: page.url(), nameState, emailRetained: Boolean(await page.getByLabel("Email", { exact: true }).inputValue()), alerts: await page.getByRole("alert").allTextContents() } }));
    throw error;
  });
  assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "review@example.test");
  await page.getByLabel("Your name").fill("UI Review");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL(`${base}/`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill("review@example.test");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "review@example.test", "A login error must retain the email");
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor({ state: "visible" });
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}/`);
  const db = openDb(dbPath);
  db.prepare("DELETE FROM activity").run(); // Keep the disposable fixture genuinely empty for the history state check.
  await page.goto(`${base}/`);
  await page.getByText("No activity yet", { exact: true }).waitFor();
  await page.getByText("Campaign changes and outreach updates will appear here as they happen.", { exact: true }).waitFor();
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Dashboard activity empty state must fit on screen");
    await screenshot(page, { path: path.join(screenshots, `dashboard-activity-empty-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  const pipelineResponse = await page.goto(`${base}/pipeline`);
  assert.equal(pipelineResponse?.status(), 200, "Pipeline should load successfully");
  await page.getByText("No leads yet", { exact: true }).waitFor();
  await page.getByText("Create a campaign and add leads to see their progress here.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Create a campaign", exact: true }).waitFor();
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Pipeline empty state must fit on screen");
    await screenshot(page, { path: path.join(screenshots, `pipeline-empty-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  await page.goto(`${base}/pipeline?campaign=not-a-number`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  await page.goto(`${base}/pipeline?campaign=999999`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  await page.goto(`${base}/`);
  await page.getByRole("link", { name: "Overview", exact: true }).waitFor();
  await page.getByRole("link", { name: "Lead progress", exact: true }).waitFor();
  await page.getByRole("link", { name: "Review messages", exact: true }).waitFor();
  await page.getByRole("link", { name: "History", exact: true }).waitFor();
  await page.goto(`${base}/activity`);
  await page.getByRole("heading", { name: "No history yet" }).waitFor();
  await page.getByText("Campaign changes and outreach activity will appear here as they happen.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Create a campaign", exact: true }).waitFor();
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "History empty state must fit on screen");
    await screenshot(page, { path: path.join(screenshots, `history-empty-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  await page.goto(`${base}/`);
  await page.goto(`${base}/campaigns/new`);
  await page.getByLabel("Campaign name", { exact: true }).fill("US business coaches");
  await page.getByLabel("Business coach", { exact: true }).check();
  await page.getByLabel("Describe the audience in your own words").fill("Independent business coaches in the United States who sell coaching through Instagram.");
  await page.getByLabel("Minimum followers", { exact: true }).fill("200000");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Minimum followers cannot be above" }).waitFor();
  assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "US business coaches");
  await page.getByLabel("Minimum followers", { exact: true }).fill("2000");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.waitForURL(/\/campaigns\/\d+$/);
  const campaignUrl = page.url();
  const id = Number(new URL(campaignUrl).pathname.split("/").pop());
  await page.goto(`${base}/pipeline?campaign=${id}`);
  await page.getByText("No leads in this campaign yet", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Add leads to this campaign", exact: true }).waitFor();
  await page.locator("summary").filter({ hasText: "Skipped (0) and why" }).click();
  await page.getByText("No skipped leads.", { exact: true }).waitFor();
  await page.goto(campaignUrl);
  await page.getByRole("heading", { name: "You’re all caught up" }).waitFor();
  await page.getByRole("link", { name: "Connect Instagram", exact: true }).waitFor();
  await page.getByRole("link", { name: "Connect Instagram", exact: true }).click();
  await page.getByRole("heading", { name: "Instagram accounts", exact: true }).waitFor();
  await page.getByRole("button", { name: "Connect account", exact: true }).waitFor();
  await page.goto(campaignUrl);
  await page.getByRole("button", { name: "Start campaign", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Choose a sending account" }).waitFor();
  await screenshot(page, { path: path.join(screenshots, "campaign-empty.png"), fullPage: true, caret: "initial" });
  const manualAccount = createAccount(db, { handle: "manual.sender", profileDir: path.join(temp, "manual.sender"), dailyCap: 35 }, "ui-fixture");
  setCampaignAccounts(db, id, [manualAccount.id]);
  await page.getByRole("button", { name: "Start campaign", exact: true }).click();
  await page.getByRole("heading", { name: "US business coaches" }).waitFor();
  const retryLead = addLead(db, { handle: "retry-check.fixture", campaignId: id }, "ui-fixture").lead;
  db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(manualAccount.id, retryLead.id);
  db.prepare("INSERT INTO jobs (type,lead_id,account_id,status,last_error) VALUES ('qualify',?,?,'failed','temporary read failure')").run(retryLead.id, manualAccount.id);
  await page.goto(`${base}/leads/${retryLead.id}`);
  await page.getByRole("button", { name: "Retry lead check", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry lead check", exact: true }).click();
  await page.getByRole("heading", { name: "Lead check queued" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='qualify' AND lead_id=? AND status='queued'").get(retryLead.id) as { n: number }).n, 1, "Manual retry should queue exactly one read-only qualification");
  assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE lead_id=?").get(retryLead.id) as { n: number }).n, 0, "Read-only qualification retry must not create messages");
  db.transaction(() => {
    db.prepare("DELETE FROM jobs WHERE lead_id=?").run(retryLead.id);
    db.prepare("DELETE FROM activity WHERE lead_id=?").run(retryLead.id);
    db.prepare("DELETE FROM leads WHERE id=?").run(retryLead.id);
  })();
  await page.goto(campaignUrl);
  await page.getByRole("link", { name: "Add leads", exact: true }).click();
  assert(await page.locator("#add-leads").getAttribute("open") !== null, "In-page link must open the disclosure");
  await page.getByLabel("Instagram handles").fill("maya.coaches\ngrowthwithalex\nstudio.sarah");
  await page.getByRole("button", { name: "Add to campaign", exact: true }).click();
  await page.getByRole("heading", { name: "3 leads in this campaign" }).waitFor();
  await page.getByLabel("Instagram handles").fill("MAYA.COACHES, growthwithalex, studio.sarah, https://invalid.example.test");
  await page.getByRole("button", { name: "Add to campaign", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "3 duplicate" }).waitFor();
  const manualLead = listLeads(db, { campaignId: id })[0];
  db.prepare("UPDATE leads SET stage='warmed',account_id=? WHERE id=?").run(manualAccount.id, manualLead.id);
  await page.goto(`${base}/leads/${manualLead.id}`);
  await page.getByRole("heading", { name: "Write a first message" }).waitFor();
  await page.getByLabel("Message 1").fill("Your workshop has a clear and practical structure.");
  await page.getByLabel("Message 2").fill("I’m Rudra at Infyum. https://portfolio.infyum.com/sales-funnel");
  await page.getByLabel("Message 3").fill("What do people usually do after attending?");
  await page.getByRole("button", { name: "Send to review", exact: true }).click();
  await page.getByText("First message · Needs review", { exact: false }).waitFor();
  assert.equal((db.prepare("SELECT status FROM messages WHERE lead_id=? AND direction='out' AND kind='dm'").get(manualLead.id) as { status: string }).status, "pending_approval");
  assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE lead_id=? AND direction='out' AND status='sent'").get(manualLead.id) as { n: number }).n, 0, "Manual composer must never send directly");
  const quietLead = addLead(db, { handle: "quiet.fixture", campaignId: null }, "ui-fixture").lead;
  db.prepare("DELETE FROM activity WHERE lead_id=?").run(quietLead.id);
  await page.goto(`${base}/leads/${quietLead.id}`);
  await page.getByText("No messages yet. Messages appear here after this lead has been contacted or replies.", { exact: true }).waitFor();
  await page.getByText("Lead checks and changes will appear here as this person moves through the campaign.", { exact: true }).waitFor();
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Lead empty conversation/history must fit on screen");
    await screenshot(page, { path: path.join(screenshots, `lead-empty-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  await page.goto(campaignUrl);
  const other = createCampaign(db, { name: "Other campaign", niches: [], audienceText: "", country: "United States", minFollowers: 2000,
    maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "ui-fixture");
  const movableLead = addLead(db, { handle: "move.fixture", campaignId: other.id }, "ui-fixture").lead;
  await page.goto(`${base}/leads/${movableLead.id}`);
  await page.getByRole("heading", { name: "Move to another campaign" }).waitFor();
  await page.getByLabel("Active campaign").selectOption(String(id));
  db.prepare("INSERT INTO jobs (type,lead_id) VALUES ('qualify',?)").run(movableLead.id);
  await page.getByRole("button", { name: "Move lead", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "work in progress" }).waitFor();
  assert.equal((db.prepare("SELECT campaign_id FROM leads WHERE id=?").get(movableLead.id) as { campaign_id: number }).campaign_id, other.id, "A lead with active work must remain in its current campaign");
  db.prepare("DELETE FROM jobs WHERE lead_id=?").run(movableLead.id);
  await page.getByRole("button", { name: "Move lead", exact: true }).click();
  for (let attempt = 0; attempt < 100; attempt++) {
    const currentCampaign = (db.prepare("SELECT campaign_id FROM leads WHERE id=?").get(movableLead.id) as { campaign_id: number | null }).campaign_id;
    if (currentCampaign === id) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const movedLead = db.prepare("SELECT campaign_id,account_id,stage FROM leads WHERE id=?").get(movableLead.id) as { campaign_id: number; account_id: number | null; stage: string };
  assert.equal(movedLead.campaign_id, id, "Moving a lead must retain one record and assign it to the selected campaign");
  assert.equal(movedLead.account_id, null, "Moving a lead must clear its previous sender assignment");
  assert.equal(movedLead.stage, "found", "The new campaign must run its usual checks");
  assert.equal((db.prepare("SELECT count(*) n FROM leads WHERE handle='move.fixture'").get() as { n: number }).n, 1, "Global deduplication must retain one lead record");
  assert.equal((db.prepare("SELECT count(*) n FROM activity WHERE lead_id=? AND action='lead.campaign_moved'").get(movableLead.id) as { n: number }).n, 1, "A campaign move must be recorded in lead history");
  await page.goto(`${base}/leads/${movableLead.id}`);
  await page.getByRole("heading", { name: "Move to another campaign" }).waitFor({ state: "detached" });
  await page.goto(`${base}/campaigns/${other.id}#add-leads`);
  await page.locator('#add-leads').evaluate((element: HTMLDetailsElement) => { element.open = true; });
  const upload = page.getByLabel("Or choose a CSV file", { exact: true });
  const uploadCsv = async (text: string, name = "leads.csv") => {
    await upload.setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
    await page.getByRole("button", { name: "Add to campaign", exact: true }).click();
  };
  await uploadCsv('name,email\nSomeone,someone@example.test');
  await page.getByRole("alert").filter({ hasText: "Include one column" }).waitFor();
  await uploadCsv('username,name\nwould.import,One\n"unfinished');
  await page.getByRole("alert").filter({ hasText: "unfinished quoted" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM leads WHERE campaign_id=?").get(other.id) as { n: number }).n, 0, "Malformed CSV must not partially import");
  await uploadCsv("username\n");
  await page.getByRole("alert").filter({ hasText: "containing leads" }).waitFor();
  await uploadCsv("x".repeat(500_001));
  await page.getByRole("alert").filter({ hasText: "500 KB" }).waitFor();
  addDnc(db, "csv.blocked", "ui-fixture");
  await uploadCsv('Name,Instagram URL\r\n"Person, one",https://instagram.com/csv.person/\r\nAgain,@CSV.PERSON\r\nBlocked,csv.blocked\r\nExisting,maya.coaches\r\nInvalid,bad handle');
  await page.getByRole("status").filter({ hasText: "1 lead added. 2 duplicate, 1 do-not-contact and 1 invalid handle skipped." }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM leads WHERE campaign_id=?").get(other.id) as { n: number }).n, 1);
  await page.getByRole("button", { name: "Add to campaign", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "0 leads added. 3 duplicate" }).waitFor();
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "CSV input must fit on screen");
    await screenshot(page, { path: path.join(screenshots, `csv-import-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  removeDnc(db, "csv.blocked");
  await page.goto(campaignUrl);
  for (const lead of listLeads(db, { campaignId: id }).filter((lead) => lead.id !== manualLead.id && lead.id !== movableLead.id)) {
    db.prepare("UPDATE leads SET stage='warmed',account_id=? WHERE id=?").run(manualAccount.id, lead.id);
    createOutgoing(db, { leadId: lead.id, accountId: null, kind: "dm", parts: ["Your weekly planning workshop has a clear, practical structure.", "I’m Rudra at Infyum, a small team in India. https://portfolio.infyum.com/sales-funnel", "How do people book a call after a workshop?"], campaign: { approvalRequired: true } }, "ui-fixture");
  }
  const unrelated = addLead(db, { handle: "another.campaign", campaignId: other.id }, "ui-fixture").lead;
  createOutgoing(db, { leadId: unrelated.id, accountId: null, kind: "dm", parts: ["Other campaign draft"], campaign: { approvalRequired: true } }, "ui-fixture");
  // Only fixture rows are inserted for chart rendering, then removed before zero-send checks.
  const historyCampaign = createCampaign(db, { name: "Campaign history review", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "ui-fixture");
  const historyLead = addLead(db, { handle: "chart.fixture", campaignId: historyCampaign.id }, "ui-fixture").lead;
  await page.goto(`${base}/campaigns/${historyCampaign.id}#progress`);
  await page.locator('#progress').evaluate((element: HTMLDetailsElement) => { element.open = true; });
  await page.getByText("No sends or first replies recorded in this period.", { exact: false }).waitFor();
  const historyMessage = createOutgoing(db, { leadId: historyLead.id, accountId: null, kind: "dm", parts: ["Chart fixture only"], campaign: { approvalRequired: true } }, "ui-fixture");
  db.prepare("UPDATE messages SET status='sent',sent_at=? WHERE id=?").run(new Date(Date.now() - 60_000).toISOString(), historyMessage.id);
  for (let index = 0; index < 2; index++) db.prepare("INSERT INTO activity(ts,actor,action,lead_id) VALUES (?,'ui-fixture','lead.handoff',?)").run(new Date(Date.now() - 60_000).toISOString(), historyLead.id);
  await page.reload();
  await page.locator('#progress').evaluate((element: HTMLDetailsElement) => { element.open = true; });
  await page.getByText("1 message sent · 1 first reply.", { exact: false }).waitFor();
  await page.locator('.campaign-history summary').click();
  assert.equal(await page.locator('.campaign-history tbody tr').count(), 14);
  assert.equal(await page.getByRole("img", { name: /Daily activity over the last 14 days/ }).count(), 1);
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Campaign chart must fit the screen");
    await screenshot(page, { path: path.join(screenshots, `campaign-history-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  db.transaction(() => {
    db.prepare("DELETE FROM activity WHERE lead_id=?").run(historyLead.id);
    db.prepare("DELETE FROM messages WHERE lead_id=?").run(historyLead.id);
    db.prepare("DELETE FROM leads WHERE id=?").run(historyLead.id);
    db.prepare("DELETE FROM campaigns WHERE id=?").run(historyCampaign.id);
  })();
  await page.goto(campaignUrl);
  await page.getByRole("heading", { name: "3 drafts need your review" }).waitFor();
  await page.goto(`${base}/accounts`);
  await page.getByLabel("Instagram handle", { exact: true }).fill("@review.account");
  await page.getByLabel("How should it connect?", { exact: true }).selectOption("chrome_read_only");
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await page.locator('div[role="status"]').filter({ hasText: "Chrome sign-in check is waiting" }).waitFor();
  await page.getByText("Connecting", { exact: true }).waitFor();
  const account = db.prepare("SELECT id,profile_dir FROM ig_accounts WHERE handle='review.account'").get() as { id: number; profile_dir: string };
  assert(account.profile_dir.startsWith(temp));
  const reviewAccountCard = page.locator(".card.divide-y > div").filter({ hasText: "@review.account" });
  setCampaignAccounts(db, id, [account.id]);
  db.prepare("UPDATE leads SET account_id=? WHERE campaign_id=?").run(account.id, id);
  db.prepare("UPDATE messages SET account_id=? WHERE lead_id IN (SELECT id FROM leads WHERE campaign_id=?) AND direction='out'").run(account.id, id);
  setCampaignAccounts(db, other.id, [account.id]); setCampaignStatus(db, other.id, "active", "ui-fixture");
  await page.goto(campaignUrl);
  await page.getByRole("heading", { name: "3 drafts need your review" }).waitFor();

  for (const mode of ["light", "dark"] as const) {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(campaignUrl);
      await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), mode);
      const palette = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return ["--ink", "--surface", "--muted", "--accent", "--on-accent", "--button-top"].map(name => css.getPropertyValue(name).trim());
      });
      const luminance = (hex: string) => {
        const rawColor = hex.replace(/^#/, "");
        const color = rawColor.length === 3 ? [...rawColor].map(channel => channel + channel).join("") : rawColor;
        const rgb = [0, 2, 4].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const contrast = [[0, 1], [2, 1], [3, 1], [4, 5]].map(([a, b]) => {
        const x = luminance(palette[a]), y = luminance(palette[b]);
        return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
      });
      assert(contrast.every(ratio => ratio >= 4.5), `Text token contrast must meet 4.5:1 in ${mode}: ${JSON.stringify({ palette, contrast })}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Campaign overflow: ${mode} ${width}`);
      await screenshot(page, { path: path.join(screenshots, `campaign-${mode}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "Appearance persists on reload");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Use system appearance" }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), null);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
  assert.equal(await page.locator(".route-enter").evaluate(el => getComputedStyle(el).animationName), "none", "Reduced motion disables entry animation");
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "Edit audience", exact: true }).focus();
  assert.notEqual(await page.getByRole("link", { name: "Edit audience", exact: true }).evaluate(el => getComputedStyle(el).outlineStyle), "none", "Keyboard focus must be visible");
  await page.getByRole("link", { name: "Edit audience", exact: true }).click();
  assert(await page.locator("#settings").getAttribute("open") !== null);
  await page.goto(campaignUrl);
  await page.getByRole("link", { name: "Review drafts", exact: true }).click();
  await page.waitForURL(new RegExp(`${base}/approvals\\?campaign=${id}$`));
  await page.locator("article").first().waitFor();
  assert.equal(await page.locator("article").count(), 3);
  assert.equal(await page.getByText("@another.campaign", { exact: true }).count(), 0);
  const firstDraft = page.locator("article").first();
  const originalSecondPart = await firstDraft.locator("textarea").nth(1).inputValue();
  await firstDraft.locator("textarea").nth(1).fill("An edited draft with an unapproved link https://example.test");
  await firstDraft.getByRole("button", { name: "Approve and queue", exact: true }).click();
  await firstDraft.getByRole("alert").filter({ hasText: "portfolio link" }).waitFor();
  assert.equal(await page.locator("article").count(), 3);
  assert.equal(await firstDraft.locator("textarea").nth(1).inputValue(), "An edited draft with an unapproved link https://example.test");
  await firstDraft.locator("textarea").nth(1).fill(originalSecondPart);
  const firstMessageId = Number((await firstDraft.getAttribute("id"))!.replace("message-", ""));
  const firstLeadId = (db.prepare("SELECT lead_id FROM messages WHERE id=?").get(firstMessageId) as { lead_id: number }).lead_id;
  db.prepare("UPDATE leads SET stage='replied' WHERE id=?").run(firstLeadId);
  await firstDraft.getByRole("button", { name: "Approve and queue", exact: true }).click();
  await firstDraft.getByRole("alert").filter({ hasText: "lead has replied" }).waitFor();
  assert.equal((db.prepare("SELECT status FROM messages WHERE id=?").get(firstMessageId) as { status: string }).status, "pending_approval");
  db.prepare("UPDATE leads SET stage='found' WHERE id=?").run(firstLeadId);
  await firstDraft.getByRole("button", { name: "Approve and queue", exact: true }).click();
  await firstDraft.getByRole("alert").filter({ hasText: "completed checks and warm-up" }).waitFor();
  assert.equal((db.prepare("SELECT status FROM messages WHERE id=?").get(firstMessageId) as { status: string }).status, "pending_approval");
  db.prepare("UPDATE leads SET stage='warmed' WHERE id=?").run(firstLeadId);
  await firstDraft.getByRole("button", { name: "Approve and queue", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article").length === 2);
  await page.goto(campaignUrl);
  await page.getByRole("heading", { name: "2 drafts need your review" }).waitFor();
  await page.goto(`${base}/approvals?campaign=${id}`);
  const rejectedMessageId = Number((await page.locator("article").first().getAttribute("id"))!.replace("message-", ""));
  await page.locator("article").first().getByRole("button", { name: "Reject", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article").length === 1);
  assert.equal((db.prepare("SELECT status FROM messages WHERE id=?").get(rejectedMessageId) as { status: string }).status, "rejected");
  const retiredLead = addLead(db, { handle: "retired.reply.fixture", campaignId: id }, "ui-fixture").lead;
  const retired = createOutgoing(db, { leadId: retiredLead.id, accountId: null, kind: "reply", parts: ["Retired reply fixture"], campaign: { approvalRequired: true } }, "ui-fixture");
  await page.reload();
  const retiredArticle = page.locator(`#message-${retired.id}`);
  assert(await retiredArticle.getByRole("button", { name: "Approve and queue" }).isDisabled());
  await retiredArticle.getByRole("button", { name: "Approve and queue" }).evaluate((el: HTMLButtonElement) => { el.disabled = false; });
  await retiredArticle.getByRole("button", { name: "Approve and queue" }).click();
  await retiredArticle.getByRole("alert").filter({ hasText: "app stops at the first reply" }).waitFor();
  assert.equal((db.prepare("SELECT status FROM messages WHERE id=?").get(retired.id) as { status: string }).status, "pending_approval");
  await retiredArticle.getByRole("button", { name: "Reject", exact: true }).click();
  await retiredArticle.waitFor({ state: "detached" });
  const bulkDraft = page.locator("article").first();
  const bulkId = Number((await bulkDraft.getAttribute("id"))!.replace("message-", ""));
  const bulkLead = (db.prepare("SELECT lead_id FROM messages WHERE id=?").get(bulkId) as { lead_id: number }).lead_id;
  const bulkEdit = "Your coaching workshop describes a thoughtful weekly planning process.";
  await bulkDraft.locator("textarea").first().fill(bulkEdit);
  await bulkDraft.getByRole("checkbox").check();
  await page.getByLabel("I’ve reviewed every selected draft", { exact: true }).check();
  db.prepare("UPDATE leads SET stage='found' WHERE id=?").run(bulkLead);
  await page.getByRole("button", { name: "Approve selected and queue", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "completed checks and warm-up" }).waitFor();
  assert.equal((db.prepare("SELECT status FROM messages WHERE id=?").get(bulkId) as { status: string }).status, "pending_approval");
  db.prepare("UPDATE leads SET stage='warmed' WHERE id=?").run(bulkLead);
  await bulkDraft.getByRole("checkbox").check();
  await page.getByLabel("I’ve reviewed every selected draft", { exact: true }).check();
  await page.getByRole("button", { name: "Approve selected and queue", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /approved and queued|This draft|Select 1 to 100/ }).waitFor();
  const bulkFeedback = await page.getByRole("status").allTextContents();
  assert(bulkFeedback.some(message => message.includes("approved and queued")), `Eligible bulk approval should succeed: ${bulkFeedback.join(" | ")}`);
  await page.getByText("Nothing waiting", { exact: true }).waitFor({ timeout: 5000 }).catch(async () => { await page.reload(); await page.getByText("Nothing waiting", { exact: true }).waitFor(); });
  assert.equal(await page.locator("article").count(), 0, "The selected draft should leave the review queue after approval");
  const bulkSaved = db.prepare("SELECT status,parts FROM messages WHERE id=?").get(bulkId) as { status: string; parts: string };
  assert.equal(bulkSaved.status, "approved"); assert.equal(JSON.parse(bulkSaved.parts)[0], bulkEdit);

  await page.goto(`${base}/leads/${unrelated.id}`);
  await page.getByLabel("Notes", { exact: true }).fill("Review notes saved through the real page.");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Notes saved" }).waitFor();
  assert.equal((db.prepare("SELECT notes FROM leads WHERE id=?").get(unrelated.id) as { notes: string }).notes, "Review notes saved through the real page.");
  const stageForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Matches", exact: true }) });
  await stageForm.locator('input[name="to"]').evaluate((el: HTMLInputElement) => { el.value = "dm_sent"; });
  await stageForm.getByRole("button").click();
  await stageForm.getByRole("alert").filter({ hasText: "stage change is not available" }).waitFor();
  assert.equal((db.prepare("SELECT stage FROM leads WHERE id=?").get(unrelated.id) as { stage: string }).stage, "found");
  await page.reload();
  await page.locator('form').filter({ has: page.locator('input[name="to"][value="qualified"]') }).getByRole("button").click();
  await page.locator(".badge").filter({ hasText: /^Matches$/ }).waitFor();
  assert.equal((db.prepare("SELECT stage FROM leads WHERE id=?").get(unrelated.id) as { stage: string }).stage, "qualified");
  await page.getByLabel("Reason (optional)", { exact: true }).fill("Read-only fixture stop");
  await page.getByRole("button", { name: "Never contact again", exact: true }).click();
  await page.getByText("Do not contact", { exact: true }).waitFor();
  assert(db.prepare("SELECT handle FROM do_not_contact WHERE handle='another.campaign'").get());
  await page.goto(`${base}/leads/not-a-number`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  await page.goto(`${base}/campaigns/not-a-number`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();

  // Operational controls must change real rows and give honest feedback without a worker.
  await page.goto(`${base}/`);
  await page.getByRole("heading", { name: "Get started" }).waitFor();
  await page.getByText("2 accounts saved. Check Accounts to see which are signed in.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Go to Campaigns", exact: true }).waitFor();
  await page.getByText("Outreach is stopped", { exact: true }).waitFor();
  db.prepare("INSERT INTO settings(key,value) VALUES('worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
  await page.getByRole("button", { name: "Check background status" }).click();
  await page.getByText("Outreach is running from a terminal", { exact: true }).waitFor();
  db.prepare("UPDATE settings SET value=? WHERE key='worker_heartbeat'").run(new Date(Date.now() - 60000).toISOString());
  await page.getByRole("button", { name: "Check background status" }).click();
  await page.getByText("Outreach is stopped", { exact: true }).waitFor();

  await page.goto(`${base}/settings`);
  await page.getByRole("heading", { name: "AI message writing", exact: true }).waitFor();
  await page.getByText("Outreach uses a separately billed Anthropic API connection.", { exact: false }).waitFor();
  await page.getByText(/Connection: (not connected on this computer|API key is set on this computer)\. Paid message writing stays paused until billing metering is reviewed\./).waitFor();
  await page.getByText("Connection details: not set up on this computer. Checking this does not run a search.", { exact: true }).waitFor();
  await page.getByRole("listitem").filter({ hasText: "@another.campaign" }).getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByText("Nobody blocked.", { exact: true }).waitFor();
  assert(["closed", "skipped"].includes((db.prepare("SELECT stage FROM leads WHERE id=?").get(unrelated.id) as { stage: string }).stage));
  db.exec("CREATE TRIGGER fail_dnc_history BEFORE INSERT ON activity WHEN NEW.action='dnc.added' BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;");
  const rollbackBlock = page.locator("section").filter({ has: page.getByRole("heading", { name: "Do not contact", exact: true }) });
  await rollbackBlock.getByLabel("Instagram handle").fill("@rollback.fixture");
  await rollbackBlock.getByRole("button", { name: "Add", exact: true }).click();
  await rollbackBlock.getByRole("alert").filter({ hasText: "Couldn’t save this change" }).waitFor();
  assert.equal(db.prepare("SELECT handle FROM do_not_contact WHERE handle='rollback.fixture'").get(), undefined, "Do-not-contact must roll back if its history row cannot be written");
  db.exec("DROP TRIGGER fail_dnc_history;");
  await page.getByLabel("Time zone", { exact: true }).fill("Mars/Olympus");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await page.getByRole("alert").filter({ hasText: "Choose a valid time zone" }).waitFor();
  assert.equal(await page.getByLabel("Time zone", { exact: true }).inputValue(), "Mars/Olympus");
  await page.getByLabel("Time zone", { exact: true }).fill("Asia/Kolkata");
  db.exec("CREATE TRIGGER fail_timezone_history BEFORE INSERT ON activity WHEN NEW.action='settings.team_timezone' BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await page.getByRole("alert").filter({ hasText: "Couldn’t save this change" }).waitFor();
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='team_timezone'").get(), undefined, "Time zone must roll back if its history row cannot be written");
  db.exec("DROP TRIGGER fail_timezone_history;");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await page.getByRole("status").filter({ hasText: "Team time zone saved" }).waitFor();
  assert.equal((db.prepare("SELECT value FROM settings WHERE key='team_timezone'").get() as { value: string }).value, "Asia/Kolkata");
  await page.getByLabel("Monthly limit (USD)", { exact: true }).fill("1.05");
  db.exec("CREATE TRIGGER fail_cap_history BEFORE INSERT ON activity WHEN NEW.action='settings.apify_cap' BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Couldn’t save this change" }).waitFor();
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='apify_monthly_cap_usd'").get(), undefined, "Lead-search cap must roll back if its history row cannot be written");
  db.exec("DROP TRIGGER fail_cap_history;");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Monthly lead-search limit saved" }).waitFor();
  assert.equal((db.prepare("SELECT value FROM settings WHERE key='apify_monthly_cap_usd'").get() as { value: string }).value, "1.05");
  db.prepare("UPDATE ig_accounts SET status='active' WHERE id=?").run(account.id);
  setCampaignStatus(db, id, "active", "ui-fixture");
  await page.goto(campaignUrl);
  await page.locator("#add-leads summary").click();
  await page.getByRole("button", { name: "Queue lead search", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Lead search is not connected" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='find_leads'").get() as { n: number }).n, 0);
  await page.goto(`${base}/settings`);
  await page.getByLabel("Monthly limit (USD)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lead searches are switched off" }).waitFor();
  assert.equal((db.prepare("SELECT value FROM settings WHERE key='apify_monthly_cap_usd'").get() as { value: string }).value, "");
  setCampaignStatus(db, id, "paused", "ui-fixture");

  const block = page.locator("section").filter({ has: page.getByRole("heading", { name: "Do not contact", exact: true }) });
  await block.getByLabel("Instagram handle").fill("@maya.coaches");
  await block.getByLabel("Reason (optional)").fill("Review fixture only");
  await block.getByRole("button", { name: "Add", exact: true }).click();
  await block.getByRole("status").filter({ hasText: "Handle added" }).waitFor();
  assert.equal((db.prepare("SELECT stage FROM leads WHERE handle='maya.coaches'").get() as { stage: string }).stage, "skipped");
  assert(db.prepare("SELECT handle FROM do_not_contact WHERE handle='maya.coaches'").get());
  await block.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByText("Nobody blocked.", { exact: true }).waitFor();
  assert(!db.prepare("SELECT handle FROM do_not_contact WHERE handle='maya.coaches'").get());

  const team = page.locator("section").filter({ has: page.getByRole("heading", { name: "Team", exact: true }) });
  assert.equal(await team.locator("form").getAttribute("method"), "post", "Password forms must never fall back to GET");
  db.exec("CREATE TRIGGER fail_team_history BEFORE INSERT ON activity WHEN NEW.action='team.added' BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;");
  await team.getByLabel("Name", { exact: true }).fill("Rollback Teammate");
  await team.getByLabel("Email", { exact: true }).fill("rollback@example.test");
  await team.getByLabel("Temporary password").fill(randomBytes(24).toString("hex"));
  await team.getByRole("button", { name: "Add teammate", exact: true }).click();
  await team.getByRole("alert").filter({ hasText: "Couldn’t save this change" }).waitFor();
  assert.equal(db.prepare("SELECT id FROM users WHERE email='rollback@example.test'").get(), undefined, "Teammate creation must roll back if its history row cannot be written");
  db.exec("DROP TRIGGER fail_team_history;");
  await team.getByLabel("Name", { exact: true }).fill("  Teammate  ");
  await team.getByLabel("Email", { exact: true }).fill("TEAMMATE@example.test");
  const teammatePassword = randomBytes(24).toString("hex");
  await team.getByLabel("Temporary password").fill(teammatePassword);
  await team.getByRole("button", { name: "Add teammate", exact: true }).click();
  await team.getByRole("status").filter({ hasText: "can now sign in" }).waitFor();
  assert.equal(await team.getByLabel("Temporary password").inputValue(), "");
  assert(db.prepare("SELECT id FROM users WHERE email='teammate@example.test' AND name='Teammate'").get());
  await team.getByLabel("Temporary password").fill(teammatePassword);
  await team.getByRole("button", { name: "Add teammate", exact: true }).click();
  await team.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
  assert.equal(await team.getByLabel("Temporary password").inputValue(), "");
  const teammatePage = await (await browser.newContext()).newPage();
  await teammatePage.goto(`${base}/login`);
  await teammatePage.getByLabel("Email", { exact: true }).fill("teammate@example.test");
  await teammatePage.getByLabel("Password", { exact: true }).fill(teammatePassword);
  await teammatePage.getByRole("button", { name: "Sign in", exact: true }).click();
  await teammatePage.waitForURL(`${base}/`); await teammatePage.context().close();
  const rateContext = await browser.newContext(), ratePage = await rateContext.newPage();
  rateContext.setDefaultTimeout(30000);
  await ratePage.goto(`${base}/login`);
  await ratePage.getByLabel("Email", { exact: true }).fill("no.such.user@example.test");
  async function rejectedLogin(expected: string) {
    await ratePage.getByLabel("Password", { exact: true }).fill("incorrect-fixture-password");
    const completed = ratePage.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/login");
    await ratePage.getByRole("button", { name: "Sign in", exact: true }).click();
    await completed;
    await ratePage.waitForFunction(() => (document.getElementById("password") as HTMLInputElement)?.value === "", undefined, { timeout: 15000 });
    await ratePage.getByRole("alert").filter({ hasText: expected }).waitFor();
  }
  for (let attempt = 0; attempt < 5; attempt++) await rejectedLogin("Email or password is wrong.");
  await rejectedLogin("Too many sign-in attempts");
  for (const mode of ["light", "dark"] as const) {
    await ratePage.getByRole("button", { name: `Use ${mode} appearance` }).click();
    for (const width of [1440, 1024, 390]) {
      await ratePage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      assert(await ratePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await ratePage.screenshot({ path: path.join(screenshots, `login-limited-${mode}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  const rateState = JSON.parse((db.prepare("SELECT value FROM settings WHERE key='auth_login_attempts'").get() as { value: string }).value) as Record<string, { startedAt: number; attempts: number }>;
  for (const window of Object.values(rateState)) window.startedAt = Date.now() - 15 * 60 * 1000;
  db.prepare("UPDATE settings SET value=? WHERE key='auth_login_attempts'").run(JSON.stringify(rateState));
  await rejectedLogin("Email or password is wrong.");
  await ratePage.getByLabel("Email", { exact: true }).fill("review@example.test");
  await ratePage.getByLabel("Password", { exact: true }).fill(password);
  await ratePage.getByRole("button", { name: "Sign in", exact: true }).click();
  await ratePage.waitForURL(`${base}/`); await rateContext.close();

  await page.goto(`${base}/accounts`);
  await page.getByLabel("Instagram handle", { exact: true }).fill("@review.account");
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "already saved" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM ig_accounts").get() as { n: number }).n, 2);
  await reviewAccountCard.getByRole("button", { name: "Check Chrome sign-in", exact: true }).click();
  await page.locator('div[role="status"]').filter({ hasText: "Chrome sign-in check is waiting" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='open_login' AND account_id=?").get(account.id) as { n: number }).n, 1);
  await page.getByText("Chrome sign-in check saved.", { exact: true }).waitFor();
  db.prepare("INSERT INTO settings(key,value) VALUES('worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
  await page.reload();
  await page.locator('div[role="status"]').filter({ hasText: "Chrome sign-in check is waiting" }).waitFor();
  const loginJob = db.prepare("SELECT id FROM jobs WHERE type='open_login' AND account_id=? ORDER BY id DESC LIMIT 1").get(account.id) as { id: number };
  db.prepare("UPDATE jobs SET status='done',payload=? WHERE id=?").run(JSON.stringify({ authenticated: false }), loginJob.id);
  await page.reload();
  await reviewAccountCard.getByText("Sign-in needed", { exact: true }).waitFor();
  assert.equal(await reviewAccountCard.getByText("active", { exact: true }).count(), 0, "An unverified account must not appear active");
  for (const mode of ["light", "dark"] as const) for (const width of [1440, 1024, 390]) {
    await page.getByRole("button", { name: `Use ${mode} appearance`, exact: true }).click();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Account login status must fit on screen");
    await screenshot(page, { path: path.join(screenshots, `account-login-request-${mode}-${width}.png`), fullPage: true, caret: "initial" });
  }
  db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(JSON.stringify({ authenticated: true }), loginJob.id);
  await page.reload();
  await reviewAccountCard.getByText("Connected", { exact: true }).waitFor();
  db.prepare("UPDATE settings SET value=? WHERE key='worker_heartbeat'").run(new Date(Date.now() - 60_000).toISOString());
  await page.goto(`${base}/accounts`);
  await page.locator('div[role="status"]').filter({ hasText: "Instagram is connected" }).waitFor();
  await reviewAccountCard.getByRole("button", { name: "Pause", exact: true }).click();
  await reviewAccountCard.getByRole("button", { name: "Resume", exact: true }).waitFor();
  assert.equal((db.prepare("SELECT status FROM ig_accounts WHERE id=?").get(account.id) as { status: string }).status, "paused");
  await reviewAccountCard.getByRole("button", { name: "Resume", exact: true }).click();
  await reviewAccountCard.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await reviewAccountCard.getByLabel("Daily cap", { exact: true }).fill("20");
  await reviewAccountCard.getByRole("button", { name: "Set cap", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Daily limit saved" }).waitFor();
  assert.equal((db.prepare("SELECT daily_cap FROM ig_accounts WHERE id=?").get(account.id) as { daily_cap: number }).daily_cap, 20);
  setCampaignStatus(db, id, "paused", "ui-fixture");
  await page.goto(campaignUrl);
  await page.getByRole("link", { name: "Edit audience", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("US business coaches revised");
  await page.getByLabel("@review.account", { exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("heading", { name: "US business coaches revised", exact: true }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM campaign_accounts WHERE campaign_id=? AND account_id=?").get(id, account.id) as { n: number }).n, 1);
  await page.getByRole("button", { name: "Resume campaign", exact: true }).click();
  await page.getByRole("button", { name: "Pause campaign", exact: true }).waitFor().catch(async error => {
    console.log(JSON.stringify({ campaignControlFailure: true, url: page.url(), status: (db.prepare("SELECT status FROM campaigns WHERE id=?").get(id) as { status: string }).status, alerts: await page.getByRole("alert").allTextContents() })); throw error;
  });
  assert.equal((db.prepare("SELECT status FROM campaigns WHERE id=?").get(id) as { status: string }).status, "active");
  await page.getByRole("button", { name: "Pause campaign", exact: true }).click();
  await page.getByRole("button", { name: "Resume campaign", exact: true }).waitFor();
  assert.equal((db.prepare("SELECT status FROM campaigns WHERE id=?").get(id) as { status: string }).status, "paused");
  await page.goto(`${base}/accounts`);
  db.prepare("UPDATE ig_accounts SET status='blocked',status_note='Simulated Instagram warning' WHERE id=?").run(account.id);
  await page.reload();
  assert(await page.getByRole("button", { name: "Stopped by Instagram", exact: true }).isDisabled());
  // Forging the hidden status and re-enabling the button must also fail on the server.
  const blockedForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Stopped by Instagram", exact: true }) });
  await blockedForm.getByRole("button").evaluate((el: HTMLButtonElement) => { el.disabled = false; });
  await blockedForm.getByRole("button").click();
  await blockedForm.getByRole("alert").filter({ hasText: "stays stopped" }).waitFor();
  assert.equal((db.prepare("SELECT status FROM ig_accounts WHERE id=?").get(account.id) as { status: string }).status, "blocked");

  const routes = ["/", "/campaigns", "/campaigns/new", "/pipeline", "/approvals", "/inbox", "/accounts", "/activity", "/settings", `/leads/${unrelated.id}`];
  for (const mode of ["dark", "light"] as const) {
    await page.getByRole("button", { name: `Use ${mode} appearance` }).click();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const route of routes) {
        await page.goto(`${base}${route}`);
        await page.locator("h1").waitFor();
        if (route === "/approvals") assert(await page.locator("textarea").evaluateAll(elements => elements.every(el => el.scrollHeight <= el.clientHeight + 2)), "Draft text must be fully visible");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${route} ${width} ${mode}`);
        await screenshot(page, { path: path.join(screenshots, `${route === "/" ? "dashboard" : route.slice(1).replaceAll("/", "-")}-${mode}-${width}.png`), fullPage: true, caret: "initial" });
      }
    }
  }
  db.prepare("INSERT INTO activity(actor,action,detail) VALUES(?,?,?)").run("=1+2", "fixture.csv", " =SUM(1,2)");
  const activityExport = await context.request.get(`${base}/activity/export`);
  assert.equal(activityExport.status(), 200);
  assert(activityExport.headers()["cache-control"].includes("no-store"));
  const activityCsv = await activityExport.text();
  assert(activityCsv.includes("\"'=1+2\""));
  assert(activityCsv.includes("\"' =SUM(1,2)\""));
  // A second local-only phase uses a fake configured key to test queueing. No worker exists.
  if (server.exitCode === null) {
    expectedServerRestart = true;
    if (!server) throw new Error("Review server stopped before queue check");
    await stopServer(server);
  }
  server = startServer(build!, "fixture-apify-token-never-used");
  let restarted = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (!server || server.exitCode !== null) throw serverStartError("Queue review server exited");
    if ((await tryLoad(`${base}/login`))?.ok) { restarted = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(restarted, "Queue review server did not restart");
  // Let the browser report the old dev-server socket closing while that expected restart is still marked.
  await page.waitForTimeout(500);
  expectedServerRestart = false;
  db.prepare("UPDATE settings SET value='1.05' WHERE key='apify_monthly_cap_usd'").run();
  db.prepare("UPDATE ig_accounts SET status='active' WHERE id=?").run(account.id);
  await page.goto(campaignUrl);
  await page.getByRole("button", { name: "Resume campaign", exact: true }).click();
  await page.getByRole("button", { name: "Pause campaign", exact: true }).waitFor();
  assert.equal((db.prepare("SELECT status FROM campaigns WHERE id=?").get(id) as { status: string }).status, "active");
  await page.goto(campaignUrl);
  await page.locator("#add-leads summary").click();
  await page.getByRole("button", { name: "Queue lead search", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lead search saved" }).waitFor();
  await page.getByRole("button", { name: "Queue lead search", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "already has a lead search" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='find_leads' AND json_extract(payload,'$.campaignId')=?").get(id) as { n: number }).n, 1);
  await page.goto(`${base}/campaigns/${other.id}`);
  await page.locator("#add-leads summary").click();
  await page.getByRole("button", { name: "Queue lead search", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lead search saved" }).waitFor();
  assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='find_leads'").get() as { n: number }).n, 2);

  await page.goto(campaignUrl);
  let stopConfirmation = "";
  page.once("dialog", dialog => { stopConfirmation = dialog.message(); void dialog.accept(); });
  await page.getByRole("button", { name: "Stop campaign", exact: true }).click();
  assert.match(stopConfirmation, /marked finished and can’t be restarted/i);
  assert.match(stopConfirmation, /message already being sent may still complete/i);
  await page.getByText("Finished", { exact: true }).waitFor();
  assert.equal((db.prepare("SELECT status FROM campaigns WHERE id=?").get(id) as { status: string }).status, "done");
  await page.getByRole("button", { name: "Stop campaign", exact: true }).waitFor({ state: "detached" });

  await page.goto(`${base}/approvals?campaign=invalid`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  await page.goto(`${base}/settings`);
  assert.equal(await page.getByRole("link", { name: "https://portfolio.infyum.com/sales-funnel", exact: true }).getAttribute("href"), "https://portfolio.infyum.com/sales-funnel");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(`${base}/login`);
  assert.equal((await context.request.get(`${base}/activity/export`, { maxRedirects: 0 })).status(), 307);
  await page.goto(campaignUrl);
  await page.waitForURL(`${base}/login`);
  for (const mode of ["light", "dark"]) {
    await page.getByRole("button", { name: `Use ${mode} appearance` }).click();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await screenshot(page, { path: path.join(screenshots, `login-${mode}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  assert.equal((db.prepare("SELECT count(*) AS count FROM messages WHERE direction='out' AND status='sent'").get() as { count: number }).count, 0);
  db.close();
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("UI smoke passed: setup, login, campaign creation, adding leads, campaign-scoped approval, live counts, appearance persistence, system theme, reduced motion, keyboard focus, authenticated routes, responsive layouts, real worker heartbeat states, time-zone/cap saves, DNC stop, teammate sign-in, duplicate account/login protection, caps/pause/resume and forged blocked-account rejection. No messages sent.");
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  if (server) await stopServer(server);
  if (build) cleanupIsolatedNextApp(build);
  rmSync(temp, { recursive: true, force: true });
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
