/** Local-only UI smoke test. Own database, no worker, no Instagram or Apify calls. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { openDb } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { createOutgoing, recordIncoming } from "@/lib/db/repos/messages";
import { addLead, listLeads } from "@/lib/db/repos/leads";

async function main() {
const temp = mkdtempSync(path.join(os.tmpdir(), "outreach-ui-"));
const dbPath = path.join(temp, "review.db");
const screenshots = path.resolve(process.env.UI_SCREENSHOT_DIR ?? "data/ui-smoke");
const port = 3190;
const base = `http://127.0.0.1:${port}`;
mkdirSync(screenshots, { recursive: true });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, DB_PATH: dbPath, SESSION_SECRET: randomBytes(48).toString("hex") }, stdio: "ignore",
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error("Review server exited before starting");
    try { if ((await fetch(`${base}/setup`)).ok) { ready = true; break; } } catch { /* server is starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "Review server did not start");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const password = randomBytes(24).toString("hex"); // Never persisted or printed.
  await page.goto(`${base}/setup`);
  await page.getByLabel("Your name").fill("UI Review");
  await page.getByLabel("Email", { exact: true }).fill("review@example.test");
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
  await page.goto(`${base}/campaigns/new`);
  await page.getByLabel("Campaign name", { exact: true }).fill("US business coaches");
  await page.getByLabel("Business coach", { exact: true }).check();
  await page.getByLabel("Describe the audience in your own words").fill("Independent business coaches in the United States who sell coaching through Instagram.");
  await page.getByLabel("Minimum followers", { exact: true }).fill("200000");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "US business coaches");
  assert(await page.getByLabel("Business coach", { exact: true }).isChecked());
  await page.getByLabel("Minimum followers", { exact: true }).fill("2000");
  await page.getByText("Booking and follow-ups", { exact: true }).click();
  await page.getByLabel("Booking link for this campaign").fill("calendly.com/test");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Booking link" }).waitFor();
  assert.equal(await page.getByLabel("Booking link for this campaign").inputValue(), "calendly.com/test");
  await page.getByLabel("Booking link for this campaign").fill("https://example.test/book");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.waitForURL(/\/campaigns\/\d+$/);
  const campaignUrl = page.url();
  const id = Number(new URL(campaignUrl).pathname.split("/").pop());
  await page.getByRole("heading", { name: "You’re all caught up" }).waitFor();
  await page.screenshot({ path: path.join(screenshots, "campaign-empty.png"), fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: "Add leads", exact: true }).click();
  assert(await page.locator("#add-leads").getAttribute("open") !== null, "In-page link must open the disclosure");
  await page.getByLabel("Instagram handles").fill("maya.coaches\ngrowthwithalex\nstudio.sarah");
  await page.getByRole("button", { name: "Add to campaign", exact: true }).click();
  await page.getByRole("heading", { name: "3 leads in this campaign" }).waitFor();
  const db = openDb(dbPath);
  const other = createCampaign(db, { name: "Other campaign", niches: [], audienceText: "", country: "United States", minFollowers: 2000,
    maxFollowers: 150000, bookingLink: "", approvalRequired: true, followupsEnabled: true }, [], "ui-fixture");
  for (const lead of listLeads(db, { campaignId: id })) {
    createOutgoing(db, { leadId: lead.id, accountId: null, kind: "dm", parts: ["Your weekly planning workshop has a clear, practical structure.", "I’m Rudra at Infyum, a small team in India. https://portfolio.infyum.com/sales-funnel", "How do people book a call after a workshop?"], campaign: { approvalRequired: true } }, "ui-fixture");
  }
  const unrelated = addLead(db, { handle: "another.campaign", campaignId: other.id }, "ui-fixture").lead;
  createOutgoing(db, { leadId: unrelated.id, accountId: null, kind: "dm", parts: ["Other campaign draft"], campaign: { approvalRequired: true } }, "ui-fixture");
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
        const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const contrast = [[0, 1], [2, 1], [3, 1], [4, 5]].map(([a, b]) => {
        const x = luminance(palette[a]), y = luminance(palette[b]);
        return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
      });
      assert(contrast.every(ratio => ratio >= 4.5), `Text token contrast must meet 4.5:1 in ${mode}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Campaign overflow: ${mode} ${width}`);
      await page.screenshot({ path: path.join(screenshots, `campaign-${mode}-${width}.png`), fullPage: true, caret: "initial" });
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
  await page.waitForURL(`${base}/approvals?campaign=${id}`);
  assert.equal(await page.locator("article").count(), 3);
  assert.equal(await page.getByText("@another.campaign", { exact: true }).count(), 0);
  const firstDraft = page.locator("article").first();
  const parts = await firstDraft.locator("textarea").allTextContents();
  for (const textarea of await firstDraft.locator("textarea").all()) await textarea.fill("");
  await firstDraft.getByRole("button", { name: "Approve for sending", exact: true }).click();
  await firstDraft.getByRole("alert").filter({ hasText: "Write a message" }).waitFor();
  for (const [index, textarea] of (await firstDraft.locator("textarea").all()).entries()) await textarea.fill(parts[index]);
  await firstDraft.getByRole("button", { name: "Approve for sending", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article").length === 2);
  await page.goto(campaignUrl);
  await page.getByRole("heading", { name: "2 drafts need your review" }).waitFor();

  const leadUrl = `/leads/${listLeads(db, { campaignId: id })[0].id}`;
  const routes = [leadUrl, "/", "/campaigns", "/campaigns/new", "/pipeline", "/approvals", "/inbox", "/accounts", "/activity", "/settings"];
  for (const mode of ["dark", "light"] as const) {
    await page.getByRole("button", { name: `Use ${mode} appearance` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const route of routes) {
        await page.goto(`${base}${route}`);
        await page.locator("h1").waitFor();
        if (route === "/approvals") assert(await page.locator("textarea").evaluateAll(elements => elements.every(el => el.scrollHeight <= el.clientHeight + 2)), "Draft text must be fully visible");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${route} ${width} ${mode}`);
        await page.screenshot({ path: path.join(screenshots, `${route === "/" ? "dashboard" : route.slice(1).replaceAll("/", "-")}-${mode}-${width}.png`), fullPage: true, caret: "initial" });
      }
    }
  }
  // Ordinary users need visible save results and errors without losing entered values.
  await page.goto(`${base}/accounts`);
  await page.getByLabel("Instagram handle", { exact: true }).fill("not a valid handle");
  await page.getByRole("button", { name: "Add Instagram account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "valid Instagram handle" }).waitFor();
  assert.equal(await page.getByLabel("Instagram handle", { exact: true }).inputValue(), "not a valid handle");
  await page.getByLabel("Instagram handle", { exact: true }).fill("test.workspace");
  await page.getByRole("button", { name: "Add Instagram account", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Account added." }).waitFor();
  await page.getByRole("button", { name: "Add Instagram account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "already added" }).waitFor();
  await page.getByRole("button", { name: "Save limit", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.goto(`${base}/settings`);
  await page.getByLabel("Monthly budget (USD)").fill("0");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.reload();
  assert.equal(await page.getByLabel("Monthly budget (USD)").inputValue(), "0");
  await page.getByLabel("Name", { exact: true }).fill("Duplicate teammate");
  await page.getByLabel("Email", { exact: true }).fill("review@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Add teammate", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "already has access" }).waitFor();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Duplicate teammate");
  await page.getByLabel("Email", { exact: true }).fill("teammate@example.test");
  await page.getByRole("button", { name: "Add teammate", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert(await page.getByLabel("Password", { exact: true }).inputValue() === "", "Clear password after teammate creation");
  const replied = addLead(db, { handle: "reply.fixture", campaignId: id, stage: "replied" }, "ui-fixture").lead;
  recordIncoming(db, replied.id, null, "Thanks. Could you tell me more?");
  await page.goto(`${base}/inbox`);
  await page.getByLabel("Reply to @reply.fixture").fill("Happy to share more about our process.");
  await page.getByRole("button", { name: "Save reply", exact: true }).click();
  await page.getByText("A reply is waiting for approval.", { exact: true }).waitFor();
  const reply = db.prepare("SELECT status FROM messages WHERE lead_id=? AND direction='out'").get(replied.id) as { status: string };
  assert.equal(reply.status, "pending_approval");
  await page.goto(`${base}/leads/${replied.id}`);
  await page.getByLabel("Notes", { exact: true }).fill("Prefers a short introduction.");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.reload();
  assert.equal(await page.getByLabel("Notes", { exact: true }).inputValue(), "Prefers a short introduction.");
  await page.screenshot({ path: path.join(screenshots, "lead-detail-light-390.png"), fullPage: true, caret: "initial" });
  await page.goto(`${base}/approvals?campaign=${id}`);
  const waiting = await page.locator("article").count();
  await page.locator("article").first().getByRole("button", { name: "Don’t send", exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll("article").length === count, waiting - 1);
  for (const mode of ["light", "dark"] as const) {
    await page.getByRole("button", { name: `Use ${mode} appearance` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const route of ["/accounts", "/inbox", "/activity", `/leads/${replied.id}`]) {
        await page.goto(`${base}${route}`);
        await page.locator("h1").waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Populated page overflow: ${route} ${width} ${mode}`);
        if (route === "/activity") {
          assert.equal(await page.getByText("auth.login", { exact: true }).isVisible(), false, "Technical events belong inside support details");
          await page.getByText("Signed in", { exact: true }).first().waitFor();
        }
        await page.screenshot({ path: path.join(screenshots, `populated-${route.slice(1).replaceAll("/", "-")}-${mode}-${width}.png`), fullPage: true, caret: "initial" });
      }
    }
  }
  await page.goto(`${base}/approvals?campaign=invalid`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  await page.goto(`${base}/settings`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(`${base}/login`);
  await page.goto(campaignUrl);
  await page.waitForURL(`${base}/login`);
  for (const mode of ["light", "dark"]) {
    await page.getByRole("button", { name: `Use ${mode} appearance` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(screenshots, `login-${mode}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  assert.equal((db.prepare("SELECT count(*) AS count FROM messages WHERE direction='out' AND status='sent'").get() as { count: number }).count, 0);
  db.close();
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("UI smoke passed: setup, login, campaign creation, adding leads, campaign-scoped approval, live counts, appearance persistence, system theme, reduced motion, keyboard focus, authenticated routes, responsive layouts, campaign validation and retained fields, empty approvals, rejection, account validation, save feedback, duplicate teammates, notes, and reply review. No messages sent.");
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true });
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
