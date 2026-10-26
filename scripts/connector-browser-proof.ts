/** Real website/device protocol; only Instagram itself is replaced by a read-only fixture. */
import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { Db } from "@/lib/db/core";
import { openLoginWindowJob } from "@/lib/services/login-window-job";
import { getDeviceCommand } from "@/lib/connectors/commands";
import { RemoteInstagramDriver } from "@/worker/remote-instagram";
import type { InstagramDriver } from "@/worker/driver";
import { ConnectorRuntime } from "@/companion/runtime";

export async function proveCustomerConnection(page: Page, other: Page, base: string, db: Db): Promise<void> {
  await page.goto(`${base}/accounts/connect`);
  await page.getByRole("button", { name: "Create connection code", exact: true }).click();
  const codeField = page.getByLabel("Connection code", { exact: true });
  await codeField.waitFor();
  const pairing = JSON.parse(Buffer.from(await codeField.inputValue(), "base64url").toString("utf8")) as { origin: string; code: string };
  assert.equal(pairing.origin, base);
  let checks = 0;
  const noWrite = async (): Promise<never> => { throw new Error("This browser proof must not perform Instagram writes"); };
  const fake: InstagramDriver = {
    openLogin: async account => { assert.equal(account.handle, "connector.fixture"); checks++; return true; },
    readFacts: noWrite, readProfileNotes: noWrite, readInbox: noWrite, warmUp: noWrite, sendMessages: noWrite,
  };
  const runtime = new ConnectorRuntime(fake);
  await runtime.pair(pairing.origin, pairing.code, "Disposable customer Mac");
  const replay = await fetch(`${base}/api/connector/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code, label: "Replay" }) });
  assert.equal(replay.status, 400, "A pairing code must work once");
  await runtime.tick();
  await page.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await page.getByLabel("Instagram handle", { exact: true }).fill("@connector.fixture");
  await page.getByRole("button", { name: "Check my Instagram sign-in", exact: true }).click();
  await page.waitForURL(`${base}/accounts`);
  const row = db.prepare("SELECT id FROM ig_accounts WHERE handle='connector.fixture'").get() as { id: number };
  assert(row, "The UI must save the account in this company's database");
  const device = db.prepare("SELECT device_id FROM account_devices WHERE account_id=?").get(row.id) as { device_id: string };
  const driver = new RemoteInstagramDriver(db, device.device_id);
  const job = db.prepare("SELECT id FROM jobs WHERE account_id=? AND type='open_login' AND status='running' ORDER BY id DESC LIMIT 1").get(row.id) as { id: number };
  assert(job, "The website must launch a sign-in check without requiring the campaign worker");
  const operation = openLoginWindowJob(db, job.id, row.id, driver);
  await runtime.tick();
  await operation;
  assert.deepEqual(db.prepare("SELECT status,payload FROM jobs WHERE id=?").get(job.id), { status: "done", payload: JSON.stringify({ authenticated: true }) }, "The real sign-in service must persist verified account evidence");
  const command = db.prepare("SELECT id,job_id FROM device_commands WHERE account_id=?").get(row.id) as { id: string; job_id: number };
  assert.equal(getDeviceCommand(db, command.id)?.status, "done");
  await page.reload();
  await page.getByText("@connector.fixture", { exact: false }).locator("..").getByText("Instagram is connected", { exact: true }).waitFor();
  await runtime.tick();
  assert.equal(checks, 1, "Completed checks must never replay");
  await other.goto(`${base}/accounts/connect`);
  assert(!(await other.locator("body").innerText()).includes("Disposable customer Mac"), "Another company must not see this paired computer");
  await page.goto(`${base}/accounts/connect`);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).waitFor({ state: "detached" });
  await runtime.tick();
  assert.equal(runtime.isConnected(), false, "Revocation must immediately reject the stored device credential");
}
