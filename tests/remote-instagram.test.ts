import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { setSetting } from "@/lib/db/repos/settings";
import { enqueue } from "@/lib/db/repos/jobs";
import { bindAccountDevice, claimDeviceCommand, completeDeviceCommand, getDeviceCommand, requestDeviceCallback } from "@/lib/connectors/commands";
import { AccountInstagramDriver } from "@/worker/instagram-driver";
import { PlaywrightInstagram } from "@/worker/instagram";
import { RemoteInstagramDriver } from "@/worker/remote-instagram";
import { InstagramSendUncertainError, InstagramWarmupUncertainError } from "@/worker/driver";
import type { IgAccount } from "@/lib/db/types";

let db: Db, account: IgAccount, now: number;
const device = "c2903587-a389-4948-8acb-afc826a8f635";
function running(type: string) {
  const id = enqueue(db, { accountId: account.id, type });
  db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);
  return id;
}
function driver(run: () => Promise<void> | void) { return new RemoteInstagramDriver(db, device, () => now, async () => { now += 500; await run(); setSetting(db, `device_seen_${device}`, String(now)); }); }
describe("customer-device Instagram driver", () => {
  beforeEach(() => {
    db = openDb(":memory:"); now = Date.now();
    account = createAccount(db, { handle: "sender", profileDir: "/server/secret/profile", dailyCap: 35 }, "test");
    bindAccountDevice(db, account.id, device);
    setSetting(db, `device_seen_${device}`, String(now));
  });
  afterEach(() => db.close());
  it.each(["missing", "stale"])("rejects a %s heartbeat before queueing a browser action", async state => {
    running("send");
    if (state === "missing") db.prepare("DELETE FROM settings WHERE key=?").run(`device_seen_${device}`);
    else setSetting(db, `device_seen_${device}`, String(now - 30_001));
    await expect(driver(() => {}).sendMessages(account, "prospect", ["hello"])).rejects.toThrow("Open Outreach Connector");
    expect(db.prepare("SELECT COUNT(*) AS n FROM device_commands").get()).toEqual({ n: 0 });
  });
  it("never falls back to a host browser when a paired customer device is offline", async () => {
    running("check_inbox");
    db.prepare("DELETE FROM settings WHERE key=?").run(`device_seen_${device}`);
    const host = vi.spyOn(PlaywrightInstagram.prototype, "readInbox").mockRejectedValue(new Error("Host browser must not be used"));
    try {
      await expect(new AccountInstagramDriver(db).readInbox(account)).rejects.toThrow("Open Outreach Connector");
      expect(host).not.toHaveBeenCalled();
    } finally { host.mockRestore(); }
  });

  it("holds a running write immediately when its device heartbeat stops", async () => {
    running("send");
    const browser = new RemoteInstagramDriver(db, device, () => now, async () => { claimDeviceCommand(db, device, now); now += 30_001; });
    await expect(browser.sendMessages(account, "prospect", ["hello"])).rejects.toBeInstanceOf(InstagramSendUncertainError);
    expect(db.prepare("SELECT status FROM device_commands").get()).toEqual({ status: "uncertain" });
  });
  it("fails a queued command plainly when its device goes offline before claiming", async () => {
    running("send");
    const browser = new RemoteInstagramDriver(db, device, () => now, async () => { now += 30_001; });
    await expect(browser.sendMessages(account, "prospect", ["hello"])).rejects.toThrow("Open Outreach Connector");
    expect(db.prepare("SELECT status FROM device_commands").get()).toEqual({ status: "failed" });
  });

  it("keeps commands bound to the running account job and exposes no server profile paths", async () => {
    const jobId = running("qualify");
    const browser = driver(() => {
      const command = claimDeviceCommand(db, device, now)!;
      expect(command).toMatchObject({ accountId: account.id, jobId, kind: "readFacts", args: { handle: "prospect" } });
      expect(JSON.stringify(command)).not.toContain(account.profileDir);
      completeDeviceCommand(db, device, command.id, { isPublic: true, country: "United States", followers: 5000, linkedToInfyum: false }, undefined, now);
    });
    await expect(browser.readFacts(account, "prospect")).resolves.toEqual({ isPublic: true, country: "United States", followers: 5000, linkedToInfyum: false });
  });
  it("rejects operations without their exact running job", async () => {
    running("check_inbox");
    await expect(driver(() => {}).sendMessages(account, "prospect", ["hello"])).rejects.toThrow("active account job");
    expect(db.prepare("SELECT COUNT(*) AS n FROM device_commands").get()).toEqual({ n: 0 });
  });
  it("never duplicates a command for a previously dispatched write", async () => {
    running("send");
    const browser = driver(() => { now += 16 * 60_000; });
    await expect(browser.sendMessages(account, "prospect", ["hello"])).rejects.toBeInstanceOf(InstagramSendUncertainError);
    await expect(browser.sendMessages(account, "prospect", ["hello"])).rejects.toBeInstanceOf(InstagramSendUncertainError);
    expect(db.prepare("SELECT COUNT(*) AS n FROM device_commands").get()).toEqual({ n: 1 });
  });
  it("marks a timed-out started write uncertain without retrying", async () => {
    running("send");
    const browser = driver(() => { claimDeviceCommand(db, device, now); now += 16 * 60_000; });
    await expect(browser.sendMessages(account, "prospect", ["hello"])).rejects.toBeInstanceOf(InstagramSendUncertainError);
    expect(db.prepare("SELECT status FROM device_commands").get()).toEqual({ status: "uncertain" });
  });
  it("satisfies each comment callback once and returns the checked completion receipt", async () => {
    running("warmup"); let id = "", ticks = 0;
    const comment = vi.fn(async () => "Your handmade details look amazing 🙌");
    const browser = driver(() => {
      if (++ticks === 1) { const cmd = claimDeviceCommand(db, device, now)!; id = cmd.id; requestDeviceCallback(db, device, id, "piece_1", "An oak table", now); }
      else {
        expect(getDeviceCommand(db, id)?.callbackResponse?.response).toBe("Your handmade details look amazing 🙌");
        completeDeviceCommand(db, device, id, { likes: 1, comments: 1, followed: true }, undefined, now);
      }
    });
    await expect(browser.warmUp(account, "prospect", 1, comment)).resolves.toEqual({ likes: 1, comments: 1, followed: true });
    expect(comment).toHaveBeenCalledExactlyOnceWith("An oak table");
  });
  it("stops polling preparation immediately when the campaign is paused", async () => {
    running("warmup"); let active = true;
    const browser = driver(() => { claimDeviceCommand(db, device, now); active = false; });
    const comment = vi.fn();
    await expect(browser.warmUp(account, "prospect", 1, comment, () => active)).rejects.toBeInstanceOf(InstagramWarmupUncertainError);
    expect(comment).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status FROM device_commands").get()).toEqual({ status: "uncertain" });
  });
  it("fails the callback and holds partial engagement when writing fails", async () => {
    running("warmup"); let id = "";
    const browser = driver(() => { const cmd = claimDeviceCommand(db, device, now); if (cmd) { id = cmd.id; requestDeviceCallback(db, device, id, "piece_1", "An oak table", now); } });
    await expect(browser.warmUp(account, "prospect", 1, async () => { throw new Error("provider secret"); })).rejects.toBeInstanceOf(InstagramWarmupUncertainError);
    expect(getDeviceCommand(db, id)?.callbackResponse?.response).toEqual({ error: "Comment preparation failed. Review this lead before retrying." });
    expect(JSON.stringify(getDeviceCommand(db, id))).not.toContain("provider secret");
  });
  it("retries a failed read only after the worker advances its attempt", async () => {
    const jobId = running("check_inbox");
    const first = driver(() => {
      const command = claimDeviceCommand(db, device, now);
      if (command) completeDeviceCommand(db, device, command.id, null, "The inbox did not load.", now);
    });
    await expect(first.readInbox(account)).rejects.toThrow("did not load");
    db.prepare("UPDATE jobs SET attempts=attempts+1 WHERE id=?").run(jobId);
    const retry = driver(() => {
      const command = claimDeviceCommand(db, device, now);
      if (command) completeDeviceCommand(db, device, command.id, [{ handle: "Prospect", text: "Tell me more" }], undefined, now);
    });
    await expect(retry.readInbox(account)).resolves.toEqual([{ handle: "prospect", text: "Tell me more" }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM device_commands").get()).toEqual({ n: 2 });
  });

  it("does not mistake a disconnected read for a successful empty inbox", async () => {
    running("check_inbox");
    await expect(driver(() => { now += 16 * 60_000; }).readInbox(account)).rejects.toThrow("did not respond");
  });
});
