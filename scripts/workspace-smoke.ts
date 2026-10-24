/** Disposable browser proof of company isolation and team joining. No worker or provider calls. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium, type BrowserContext, type Page } from "playwright";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { logActivity } from "@/lib/db/repos/activity";
import { buildIsolatedNextApp, cleanupIsolatedNextApp, type IsolatedNextBuild } from "./isolated-next-build";

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}

function databaseFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? databaseFiles(filename) : entry.name.endsWith(".db") ? [filename] : [];
  });
}

function companyDatabase(directory: string, campaign: string): Db {
  for (const filename of databaseFiles(directory)) {
    const candidate = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      if (candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaigns'").get()
        && candidate.prepare("SELECT id FROM campaigns WHERE name=?").get(campaign)) return openDb(filename);
    } finally { candidate.close(); }
  }
  throw new Error("The company campaign was not persisted in its disposable database");
}

async function register(page: Page, base: string, input: { name: string; email: string; password: string; company: string }) {
  await page.goto(`${base}/register`);
  await page.locator('input[name="name"]').fill(input.name);
  await page.locator('input[name="email"]').fill(input.email);
  await page.locator('input[name="password"]').fill(input.password);
  await page.locator('input[name="workspaceName"]').fill(input.company);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(`${base}/`);
}

async function createCampaign(page: Page, base: string, name: string) {
  await page.goto(`${base}/campaigns/new`);
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await page.getByLabel("Business coach", { exact: true }).check();
  await page.getByLabel("Describe the audience in your own words").fill("Independent business coaches. Disposable local browser proof only.");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.waitForURL(/\/campaigns\/\d+$/);
  await page.getByRole("heading", { name, exact: true }).waitFor();
}

function seedPrivateFixture(db: Db, directory: string, email: string, marker: string) {
  const user = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  assert(user, "A workspace must contain its member for operational billing references");
  createAccount(db, { handle: `${marker}.private.fixture`, profileDir: path.join(directory, marker, "unused"), browserMode: "isolated" }, "workspace-smoke");
  logActivity(db, "workspace-smoke", "fixture.private", { detail: `${marker}-private-history` });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO billing_usage_events(event_key,user_id,occurred_at,kind,quantity,unit_cost_micros,unit_quantity,cost_micros,provider_ref,source_json,created_at)
    VALUES(?,?,?,'apify',1,1234500,1,1234500,?,'{}',?)`).run(`${marker}-fixture`, user.id, now, `${marker}-private-provider-reference`, now);
  return user.id;
}

async function assertPrivatePages(page: Page, base: string, own: string, other: string, campaignName: string) {
  await page.goto(`${base}/campaigns`);
  await page.getByRole("link", { name: campaignName, exact: false }).waitFor();
  assert(!(await page.locator("body").innerText()).includes(`${other} company campaign`), "Another company’s campaign must stay private");
  await page.goto(`${base}/accounts`);
  await page.getByText(`@${own}.private.fixture`, { exact: false }).waitFor();
  assert(!(await page.locator("body").innerText()).includes(`${other}.private.fixture`), "Another company’s Instagram account must stay private");
  await page.goto(`${base}/activity`);
  assert((await page.locator("body").innerText()).includes(`${own}-private-history`));
  assert(!(await page.locator("body").innerText()).includes(`${other}-private-history`), "Another company’s history must stay private");
  const usage = await page.context().request.get(`${base}/billing/export`);
  assert.equal(usage.status(), 200);
  assert.match(usage.headers()["cache-control"], /no-store/);
  const csv = await usage.text();
  assert(csv.includes(`${own}-private-provider-reference`), "The user must see their own recorded usage");
  assert(!csv.includes(`${other}-private-provider-reference`), "Billing export must never include another company’s costs");
  const history = await page.context().request.get(`${base}/activity/export`);
  const historyCsv = await history.text();
  assert(historyCsv.includes(`${own}-private-history`));
  assert(!historyCsv.includes(`${other}-private-history`));
}

async function switchTo(page: Page, base: string, company: string) {
  await page.goto(`${base}/workspaces`);
  await page.getByRole("button", { name: `Switch to ${company}`, exact: true }).click();
  await page.waitForURL(`${base}/`);
}

async function invitation(page: Page, base: string, email: string): Promise<string> {
  await page.goto(`${base}/workspaces`);
  const form = page.locator("form").filter({ has: page.locator('input[name="email"]') });
  await form.locator('input[name="email"]').fill(email);
  await form.getByRole("button", { name: "Create invitation", exact: true }).click();
  const link = page.getByLabel("Invitation link", { exact: true });
  await link.waitFor();
  return link.inputValue();
}

async function fillInvitation(page: Page, link: string, email: string, password: string, name = "") {
  await page.goto(link);
  await page.waitForFunction(() => Boolean((document.querySelector('input[name="token"]') as HTMLInputElement | null)?.value));
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  if (name) await page.locator('input[name="name"]').fill(name);
}

async function acceptInvitation(page: Page, link: string, email: string, password: string, name = "") {
  await fillInvitation(page, link, email, password, name);
  await page.getByRole("button", { name: /join/i }).click();
  await page.waitForURL(url => url.pathname === "/" || url.pathname === "/workspaces");
}

async function main() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "outreach-workspaces-"));
  const dbPath = path.join(temp, "review.db"), sessionSecret = randomBytes(48).toString("hex");
  const screenshots = path.resolve(process.env.WORKSPACE_SCREENSHOT_DIR ?? "data/workspace-smoke");
  const base = "http://127.0.0.1:3192";
  mkdirSync(screenshots, { recursive: true });
  let build: IsolatedNextBuild | undefined, server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const databases: Db[] = [], browserErrors: string[] = [], externalRequests: string[] = [];
  let serverOutput = "";
  try {
    build = process.env.WORKSPACE_SMOKE_DIST ? { distDir: process.env.WORKSPACE_SMOKE_DIST, tsconfigPath: `${process.env.WORKSPACE_SMOKE_DIST.replace(".next-smoke-", ".tsconfig-smoke-")}.json` } : buildIsolatedNextApp("ui", [sessionSecret]);
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3192"], {
      env: { ...process.env, NODE_ENV: "production", OUTREACH_SMOKE_MODE: "1", OUTREACH_SMOKE_DIST_DIR: build.distDir, OUTREACH_SMOKE_TSCONFIG: build.tsconfigPath, DB_PATH: dbPath, PROFILES_DIR: path.join(temp, "profiles"), SESSION_SECRET: sessionSecret, APIFY_TOKEN: "", ANTHROPIC_API_KEY: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", BILLING_OWNER_USER_ID: "", APP_URL: base },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-4_000); };
    server.stdout?.on("data", capture); server.stderr?.on("data", capture);
    let ready = false;
    const deadline = Date.now() + 45_000;
    while (!ready && Date.now() < deadline && server.exitCode === null) {
      try { ready = (await fetch(`${base}/register`, { signal: AbortSignal.timeout(1_000) })).ok; } catch { /* Local server starting. */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error(`Workspace review server did not start:\n${serverOutput.replaceAll(sessionSecret, "[redacted]").replaceAll(temp, "[temporary smoke directory]")}`);
    browser = await chromium.launch();
    async function context(): Promise<BrowserContext> {
      const result = await browser!.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      result.setDefaultTimeout(20_000);
      await result.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        externalRequests.push(url.origin); return route.abort();
      });
      result.on("page", page => page.on("pageerror", error => browserErrors.push(error.message)));
      return result;
    }
    const alphaContext = await context(), betaContext = await context();
    const alpha = await alphaContext.newPage(), beta = await betaContext.newPage();
    const alphaPassword = randomBytes(24).toString("hex"), betaPassword = randomBytes(24).toString("hex");
    await register(alpha, base, { name: "Alpha owner", email: "alpha@example.test", password: alphaPassword, company: "Alpha Company" });
    await createCampaign(alpha, base, "alpha company campaign");
    const alphaDb = companyDatabase(temp, "alpha company campaign"); databases.push(alphaDb);
    seedPrivateFixture(alphaDb, temp, "alpha@example.test", "alpha");
    alphaDb.prepare("INSERT INTO campaigns(id,name,approval_required) VALUES(900001,'alpha inaccessible campaign',1)").run();
    await register(beta, base, { name: "Beta owner", email: "beta@example.test", password: betaPassword, company: "Beta Company" });
    await createCampaign(beta, base, "beta company campaign");
    const betaDb = companyDatabase(temp, "beta company campaign"); databases.push(betaDb);
    assert.notEqual(alphaDb.name, betaDb.name, "Companies must use independent operational databases");
    const betaUserId = seedPrivateFixture(betaDb, temp, "beta@example.test", "beta");
    await assertPrivatePages(alpha, base, "alpha", "beta", "alpha company campaign");
    await assertPrivatePages(beta, base, "beta", "alpha", "beta company campaign");
    const foreignCampaign = await betaContext.request.get(`${base}/campaigns/900001`);
    // Next can stream the authenticated shell before notFound(), retaining HTTP 200.
    const denied = await foreignCampaign.text();
    assert([200, 404].includes(foreignCampaign.status()));
    assert(!denied.includes("alpha inaccessible campaign"), "Foreign campaign data must never be rendered");
    assert(denied.includes("NEXT_HTTP_ERROR_FALLBACK;404") || denied.includes("This page could not be found"), "A foreign campaign must render not found");

    // One person may belong to both their private company and a shared team.
    const invite = await invitation(alpha, base, "beta@example.test");
    assert(new URL(invite).hash || new URL(invite).searchParams.has("token"), "Invitation must contain its generated token");
    await fillInvitation(alpha, invite, "alpha@example.test", alphaPassword);
    await alpha.getByRole("button", { name: /join/i }).click();
    await alpha.getByRole("alert").waitFor();
    assert(new URL(alpha.url()).pathname === "/join", "An invitation must reject a different signed-in email without consuming it");
    await acceptInvitation(beta, invite, "beta@example.test", betaPassword);
    await beta.goto(`${base}/campaigns`);
    await beta.getByRole("link", { name: "alpha company campaign", exact: false }).waitFor();
    assert(!(await beta.locator("body").innerText()).includes("beta company campaign"));
    const staleForm = await betaContext.newPage();
    await staleForm.goto(`${base}/campaigns/new`);
    await staleForm.getByLabel("Campaign name", { exact: true }).fill("stale workspace campaign");
    await staleForm.getByLabel("Business coach", { exact: true }).check();
    await staleForm.getByLabel("Describe the audience in your own words").fill("A stale form must never write into the new workspace.");
    await switchTo(beta, base, "Beta Company");
    await staleForm.getByRole("button", { name: "Create campaign", exact: true }).click();
    await staleForm.getByRole("alert").waitFor();
    assert.equal(alphaDb.prepare("SELECT id FROM campaigns WHERE name='stale workspace campaign'").get(), undefined);
    assert.equal(betaDb.prepare("SELECT id FROM campaigns WHERE name='stale workspace campaign'").get(), undefined, "A form opened in another workspace must not write into the newly selected company");
    await staleForm.close();
    await beta.goto(`${base}/campaigns`);
    await beta.getByRole("link", { name: "beta company campaign", exact: false }).waitFor();
    await fillInvitation(beta, invite, "beta@example.test", betaPassword);
    await beta.getByRole("button", { name: /join/i }).click();
    await beta.getByRole("alert").waitFor();
    assert(new URL(beta.url()).pathname === "/join", "A consumed invitation must not grant another membership or switch workspace");

    // Removing membership must revoke access from an already authenticated team session.
    await switchTo(beta, base, "Alpha Company");
    await alpha.goto(`${base}/workspaces`);
    const memberForm = alpha.locator("form").filter({ has: alpha.locator(`input[name="userId"][value="${betaUserId}"]`) });
    alpha.once("dialog", dialog => { void dialog.accept(); });
    await memberForm.getByRole("button", { name: "Remove beta@example.test", exact: true }).click();
    await memberForm.waitFor({ state: "detached" });
    const removedResponse = await betaContext.request.get(`${base}/campaigns/900001`, { maxRedirects: 0 });
    assert.notEqual(removedResponse.status(), 200, "Removed members must lose active company access immediately");

    const newInvite = await invitation(alpha, base, "new.teammate@example.test");
    const newContext = await context(), newMember = await newContext.newPage();
    const newPassword = randomBytes(24).toString("hex");
    await acceptInvitation(newMember, newInvite, "new.teammate@example.test", newPassword, "New teammate");
    await newMember.goto(`${base}/campaigns`);
    await newMember.getByRole("link", { name: "alpha company campaign", exact: false }).waitFor();
    await newMember.goto(`${base}/workspaces`);
    assert.equal(await newMember.getByLabel("Teammate’s email", { exact: true }).count(), 0, "A teammate must not receive the owner’s invitation controls");
    const leftoverInvite = await invitation(alpha, base, "new.teammate@example.test");
    alpha.once("dialog", dialog => { void dialog.accept(); });
    await alpha.getByRole("button", { name: "Remove new.teammate@example.test", exact: true }).click();
    await alpha.getByRole("button", { name: "Remove new.teammate@example.test", exact: true }).waitFor({ state: "detached" });
    await fillInvitation(newMember, leftoverInvite, "new.teammate@example.test", newPassword);
    await newMember.getByRole("button", { name: "Join team", exact: true }).click();
    await newMember.getByRole("alert").waitFor();
    await register(newMember, base, { name: "New teammate", email: "new.teammate@example.test", password: newPassword, company: "Independent company" });
    await newMember.goto(`${base}/campaigns`);
    await newMember.getByText("No campaigns yet", { exact: true }).waitFor();
    assert(!(await newMember.locator("body").innerText()).includes("alpha company campaign"));
    await newContext.close();

    // A copied old cookie must not become usable again after signing out.
    const staleCookies = await alphaContext.cookies();
    await alpha.getByRole("button", { name: "Sign out", exact: true }).click();
    await alpha.waitForURL(`${base}/login`);
    const stale = await context(); await stale.addCookies(staleCookies);
    const replay = await stale.newPage(); await replay.goto(`${base}/campaigns`);
    await replay.waitForURL(`${base}/login`);

    await beta.goto(`${base}/login`);
    await beta.locator('input[name="email"]').fill("beta@example.test");
    await beta.locator('input[name="password"]').fill(betaPassword);
    await beta.getByRole("button", { name: "Sign in", exact: true }).click();
    await beta.waitForURL(`${base}/`);
    for (const theme of ["light", "dark"] as const) {
      await beta.getByRole("button", { name: `Use ${theme} appearance`, exact: true }).click();
      for (const width of [1440, 390]) {
        await beta.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const route of ["/", "/workspaces"]) {
          await beta.goto(base + route); await beta.locator("h1").waitFor();
          assert(await beta.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Workspace onboarding must fit ${width}px in ${theme} appearance`);
          await beta.screenshot({ path: path.join(screenshots, `${route === "/" ? "overview" : "workspaces"}-${theme}-${width}.png`), fullPage: true });
        }
      }
    }
    const publicContext = await context(), publicPage = await publicContext.newPage();
    for (const theme of ["light", "dark"] as const) {
      await publicPage.goto(`${base}/register`);
      await publicPage.getByRole("button", { name: `Use ${theme} appearance`, exact: true }).click();
      for (const width of [1440, 390]) {
        await publicPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const route of ["/register", "/join"]) {
          await publicPage.goto(base + route); await publicPage.locator("h1").waitFor();
          assert(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Registration and team joining must fit ${width}px in ${theme} appearance`);
          await publicPage.screenshot({ path: path.join(screenshots, `${route.slice(1)}-${theme}-${width}.png`), fullPage: true });
        }
      }
    }
    await publicContext.close();
    for (const db of databases) {
      assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE direction='out' AND status='sent'").get() as { n: number }).n, 0);
      assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE status IN ('queued','running')").get() as { n: number }).n, 0, "Onboarding must not start external work");
    }
    assert.deepEqual(browserErrors, [], "No browser runtime errors");
    assert.deepEqual(externalRequests, [], "No external browser calls");
    console.log("Workspace smoke passed: two private companies, campaign/account/history/billing isolation, foreign-ID rejection, team invitation, switching, stale-form rejection, one-use invitation, member removal, session revocation, and responsive light/dark onboarding. No worker, message, provider call or payment.");
    console.log(`Screenshots: ${screenshots}`);
  } finally {
    await browser?.close();
    if (server) await stopServer(server);
    for (const db of databases) db.close();
    if (build && process.env.WORKSPACE_SMOKE_KEEP_BUILD !== "1" && !process.env.WORKSPACE_SMOKE_DIST) cleanupIsolatedNextApp(build);
    else if (build) console.log(`Reusable smoke build: ${build.distDir}`);
    rmSync(temp, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
