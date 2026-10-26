/** Exercises the actual packaged executable without Chrome, pairing, or user data. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export async function verifyPackagedConnector(executable: string, screenshots: string): Promise<void> {
  const temporary = mkdtempSync(path.join(tmpdir(), "outreach-package-"));
  const child = spawn(executable, [], {
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: temporary, NODE_ENV: "production", OUTREACH_CONNECTOR_DATA_DIR: temporary, OUTREACH_CONNECTOR_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", code => resolve(code)); child.once("error", reject); });
  let output = "";
  child.stdout?.on("data", chunk => { output = (output + chunk.toString()).slice(-4000); });
  child.stderr?.on("data", chunk => { output = (output + chunk.toString()).slice(-4000); });
  try {
    const deadline = Date.now() + 15_000;
    let origin = "";
    while (!origin && Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Packaged connector exited before startup: ${output}`);
      origin = output.match(/Open (http:\/\/127\.0\.0\.1:\d+) to connect Outreach\./)?.[1] ?? "";
      if (!origin) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(origin, "Packaged connector must start its local page");
    const page = await fetch(origin, { signal: AbortSignal.timeout(2000) });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert(html.includes("Your Instagram stays on your Mac."));
    const token = html.match(/const token="([a-f0-9]{64})"/)?.[1];
    assert(token, "The packaged page must use its local request token");
    const code = Buffer.from(JSON.stringify({ origin: "https://example.invalid", code: "x".repeat(43) })).toString("base64url");
    const headers = { "content-type": "application/json", origin, "x-connector-token": token };
    const preview = await fetch(`${origin}/preview`, { method: "POST", headers, body: JSON.stringify({ code }) });
    assert.deepEqual(await preview.json(), { website: "https://example.invalid" });
    assert.equal((await fetch(`${origin}/preview`, { method: "POST", headers: { origin }, body: "{}" })).status, 403);
    const refused = await fetch(`${origin}/connect`, { method: "POST", headers, body: JSON.stringify({ code, website: "https://example.invalid", allow: false }) });
    assert.equal(refused.status, 400, "Pairing requires the user's explicit local approval");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(origin); await page.getByLabel("Connection code").fill(code);
      await page.getByRole("button", { name: "Review connection", exact: true }).click();
      await page.getByText("https://example.invalid", { exact: true }).waitFor();
      mkdirSync(screenshots, { recursive: true });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Connector UI must fit the customer's screen");
          await page.screenshot({ path: path.join(screenshots, `connector-${colorScheme}-${width}.png`), fullPage: true });
        }
      }
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Allow and connect", exact: true }).isVisible(), false);
      await page.getByRole("button", { name: "Quit connector", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Connector closed" }).waitFor();
    } finally { await browser.close(); }
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { assert.equal(await exited, 0, "Quit must stop the actual packaged executable cleanly"); }
    finally { clearTimeout(timeout); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited.catch(() => {}); }
    rmSync(temporary, { recursive: true, force: true });
  }
}
