import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import { createWorkspace } from "@/lib/workspaces/catalog";
import { createPairing, exchangePairing, revokeDevice } from "@/lib/connectors/catalog";
import { bindAccountDevice, createDeviceCommand, getDeviceCommand, respondDeviceCallback } from "@/lib/connectors/commands";
import { commandMayContinue } from "@/lib/connectors/authorization";
import { POST as pair } from "@/app/api/connector/pair/route";
import { POST as poll } from "@/app/api/connector/poll/route";
import { POST as result } from "@/app/api/connector/result/route";
import { POST as callback } from "@/app/api/connector/callback/route";
import { POST as kill } from "@/app/api/connector/kill/route";
import { killSwitchOn, setKillSwitch } from "@/lib/services/kill-switch";
const state = vi.hoisted(() => ({ identity: null as Db | null, workspaces: new Map<string, Db>(), getWorkspaceDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspaces/storage", () => ({ getIdentityDb: () => state.identity, getWorkspaceDb: (id: string) => state.getWorkspaceDb(id) }));
let identity: Db, db: Db, otherDb: Db, owner: number, workspace: string, otherWorkspace: string;
let device: ReturnType<typeof exchangePairing>, secondDevice: ReturnType<typeof exchangePairing>, otherDevice: ReturnType<typeof exchangePairing>;
function request(path: string, token?: string, body: unknown = {}, origin?: string): Request {
  return new Request(`https://outreach.example/api/connector/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}
function task(kind: "readInbox" | "warmUp" | "sendMessages" = "readInbox") {
  const type = kind === "readInbox" ? "check_inbox" : kind === "warmUp" ? "warmup" : "send";
  const jobId = Number(db.prepare("INSERT INTO jobs(type,lead_id,account_id,status,payload,attempts) VALUES (?,1,1,'running',?,1)").run(type, JSON.stringify({ messageId: 1 })).lastInsertRowid);
  return createDeviceCommand(db, { deviceId: device.device.id, accountId: 1, jobId, kind, args: kind === "readInbox" ? {} : kind === "warmUp" ? { handle: "prospect", pieces: 10 } : { handle: "prospect", parts: ["Hello prospect"] } });
}
beforeEach(() => {
  identity = openDb(":memory:"); db = openDb(":memory:"); otherDb = openDb(":memory:"); state.identity = identity;
  owner = createUser(identity, "owner@example.com", "Owner", "hash").id;
  const outsider = createUser(identity, "other@example.com", "Other", "hash").id;
  workspace = createWorkspace(identity, owner, "First").id; otherWorkspace = createWorkspace(identity, outsider, "Second").id;
  state.workspaces = new Map([[workspace, db], [otherWorkspace, otherDb]]);
  state.getWorkspaceDb.mockReset().mockImplementation((id: string) => { const value = state.workspaces.get(id); if (!value) throw new Error("Unknown workspace"); return value; });
  device = exchangePairing(identity, createPairing(identity, owner, workspace), "First Mac");
  secondDevice = exchangePairing(identity, createPairing(identity, owner, workspace), "Second Mac");
  otherDevice = exchangePairing(identity, createPairing(identity, outsider, otherWorkspace), "Other company Mac");
  for (const operational of [db, otherDb]) operational.exec(`
    INSERT INTO ig_accounts(id,handle,profile_dir,daily_cap,ramp_start) VALUES (1,'sender','/private/host/secret-profile',35,'2020-01-01');
    INSERT INTO campaigns(id,name,status,approval_required) VALUES (1,'Campaign','active',1);
    INSERT INTO campaign_accounts(campaign_id,account_id) VALUES (1,1);
    INSERT INTO leads(id,handle,campaign_id,account_id,stage) VALUES (1,'prospect',1,1,'warmed');
    INSERT INTO messages(id,lead_id,account_id,direction,kind,parts,status) VALUES (1,1,1,'out','dm','["Hello prospect"]','approved');
    INSERT INTO settings(key,value) VALUES ('team_timezone','UTC');
  `);
  bindAccountDevice(db, 1, device.device.id); bindAccountDevice(otherDb, 1, otherDevice.device.id);
});
afterEach(() => { db.close(); otherDb.close(); identity.close(); });
it("authenticates before opening company data and rejects cross-origin or revoked device requests", async () => {
  expect((await poll(request("poll"))).status).toBe(401);
  expect((await poll(request("poll", "x".repeat(43)))).status).toBe(401);
  expect((await poll(request("poll", device.token, {}, "https://evil.example"))).status).toBe(403);
  revokeDevice(identity, owner, workspace, device.device.id);
  expect((await poll(request("poll", device.token))).status).toBe(401);
  expect(state.getWorkspaceDb).not.toHaveBeenCalled();
});
it("accepts the Outreach Chrome extension origin but only with a valid device token", async () => {
  const extension = "chrome-extension://" + "a".repeat(32);
  expect((await poll(request("poll", device.token, {}, extension))).status).toBe(200);
  expect((await poll(request("poll", undefined, {}, extension))).status).toBe(401);
  expect((await poll(request("poll", device.token, {}, "chrome-extension://short"))).status).toBe(403);
});
it("pairs one time without opening operational data and rejects expired or replayed codes", async () => {
  const code = createPairing(identity, owner, workspace);
  const response = await pair(request("pair", undefined, { code, label: "New device" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json(); expect(body.device.workspaceId).toBe(workspace); expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await pair(request("pair", undefined, { code, label: "Replay" }))).status).toBe(400);
  const expired = createPairing(identity, owner, workspace, Date.now() - 300_000);
  expect((await pair(request("pair", undefined, { code: expired, label: "Expired" }))).status).toBe(400);
  expect(state.getWorkspaceDb).not.toHaveBeenCalled();
});
it("delivers only validated command data and accepts one completion without exposing host paths", async () => {
  const command = task();
  const response = await poll(request("poll", device.token));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.command).toEqual({ id: command.id, kind: "readInbox", args: {}, expiresAt: command.expiresAt, account: { id: 1, handle: "sender" } });
  expect(JSON.stringify(body)).not.toContain("profile");
  expect((await poll(request("poll", device.token))).status).toBe(200);
  expect((await result(request("result", device.token, { id: command.id, result: [{ handle: "prospect", text: "Hi" }] }))).status).toBe(200);
  expect((await result(request("result", device.token, { id: command.id, result: [] }))).status).toBe(409);
});
it("denies other companies and other devices completion or continuation access", async () => {
  const command = task(); await poll(request("poll", device.token));
  expect((await result(request("result", otherDevice.token, { id: command.id, result: [] }))).status).toBe(404);
  expect((await result(request("result", secondDevice.token, { id: command.id, result: [] }))).status).toBe(404);
  expect((await poll(request("poll", otherDevice.token, { commandId: command.id }))).status).toBe(404);
  expect((await poll(request("poll", secondDevice.token, { commandId: command.id }))).status).toBe(404);
  expect(getDeviceCommand(db, command.id)?.status).toBe("running");
  expect(otherDb.prepare("SELECT id FROM device_commands").all()).toEqual([]);
});
it("stops remote execution when the source task, source attempt or device binding changes", () => {
  const command = task(); expect(commandMayContinue(db, command)).toBe(true);
  db.prepare("UPDATE jobs SET attempts=2 WHERE id=?").run(command.jobId);
  expect(commandMayContinue(db, command)).toBe(false);
  db.prepare("UPDATE jobs SET attempts=1,status='done' WHERE id=?").run(command.jobId);
  expect(commandMayContinue(db, command)).toBe(false);
});
it.each(["campaign", "account", "dnc", "approval", "parts", "cap", "stage", "sender"])("denies sending after %s authorization changes", (reason) => {
  const command = task("sendMessages"); expect(commandMayContinue(db, command)).toBe(true);
  if (reason === "campaign") db.exec("UPDATE campaigns SET status='paused'");
  if (reason === "account") db.exec("UPDATE ig_accounts SET status='blocked'");
  if (reason === "dnc") db.exec("INSERT INTO do_not_contact(handle) VALUES ('prospect')");
  if (reason === "approval") db.exec("UPDATE messages SET status='pending_approval'");
  if (reason === "parts") db.exec(`UPDATE messages SET parts='["Changed without approval"]'`);
  if (reason === "cap") db.exec("UPDATE ig_accounts SET daily_cap=0");
  if (reason === "stage") db.exec("UPDATE leads SET stage='replied'");
  if (reason === "sender") db.exec("DELETE FROM campaign_accounts");
  expect(commandMayContinue(db, command)).toBe(false);
});
it("cancels a queued send rather than delivering it when its campaign stops", async () => {
  const command = task("sendMessages"); db.exec("UPDATE campaigns SET status='paused'");
  const response = await poll(request("poll", device.token)); expect(await response.json()).toEqual({ command: null });
  expect(getDeviceCommand(db, command.id)?.status).toBe("uncertain");
});
it("routes warmup writing callbacks only to the authorized command and returns bounded errors", async () => {
  db.exec("UPDATE leads SET stage='qualified'"); const command = task("warmUp"); await poll(request("poll", device.token));
  expect((await callback(request("callback", secondDevice.token, { id: command.id, callbackId: "one", context: "Post text" }))).status).toBe(409);
  expect((await callback(request("callback", device.token, { id: command.id, callbackId: "one", context: "Post text" }))).status).toBe(202);
  expect(respondDeviceCallback(db, command.id, "one", { error: "Writing is unavailable" })).toBe(true);
  const response = await poll(request("poll", device.token, { commandId: command.id }));
  expect((await response.json()).command.callbackResponse).toEqual({ id: "one", response: { error: "Writing is unavailable" } });
  expect((await callback(request("callback", device.token, { id: command.id, callbackId: "two", context: "x".repeat(5001) }))).status).toBe(400);
});
it("rejects malformed results and applies a reported Instagram warning only to the bound account", async () => {
  const command = task(); await poll(request("poll", device.token));
  expect((await result(request("result", device.token, { id: command.id, result: [{ arbitrary: "invalid" }] }))).status).toBe(400);
  expect((await result(request("result", device.token, { id: command.id, error: "Instagram warning", blockedByInstagram: true }))).status).toBe(200);
  expect(db.prepare("SELECT status FROM ig_accounts WHERE id=1").get()).toEqual({ status: "blocked" });
  expect(otherDb.prepare("SELECT status FROM ig_accounts WHERE id=1").get()).toEqual({ status: "active" });
});
it("denies stale binding, expired commands and write jobs aimed at a different prospect", () => {
  const command = task("sendMessages");
  db.prepare("UPDATE account_devices SET device_id=? WHERE account_id=1").run(secondDevice.device.id);
  expect(commandMayContinue(db, command)).toBe(false);
  db.prepare("UPDATE account_devices SET device_id=? WHERE account_id=1").run(device.device.id);
  expect(commandMayContinue(db, { ...command, expiresAt: Date.now() - 1 })).toBe(false);
  expect(commandMayContinue(db, { ...command, args: { ...command.args, handle: "different" } })).toBe(false);
});
it("returns first-reply stop immediately to an already running sending device", async () => {
  const command = task("sendMessages"); await poll(request("poll", device.token));
  db.exec("UPDATE leads SET stage='replied'");
  const response = await poll(request("poll", device.token, { commandId: command.id }));
  expect((await response.json()).continue).toBe(false);
  expect(getDeviceCommand(db, command.id)?.status).toBe("uncertain");
});
it("rejects oversized or non-JSON device bodies with a generic bounded response", async () => {
  const oversized = new Request("https://outreach.example/api/connector/poll", { method: "POST", headers: { authorization: `Bearer ${device.token}`, "content-type": "application/json" }, body: JSON.stringify({ extra: "x".repeat(128_001) }) });
  const rejected = await poll(oversized); expect(rejected.status).toBe(400); expect(JSON.stringify(await rejected.json()).length).toBeLessThan(200);
  const form = new Request("https://outreach.example/api/connector/poll", { method: "POST", headers: { authorization: `Bearer ${device.token}`, "content-type": "text/plain" }, body: "{}" });
  expect((await poll(form)).status).toBe(400);
});

it("the extension's Stop button switches everything off, and a running task is told to stop", async () => {
  const command = task();
  expect(commandMayContinue(db, command)).toBe(true);
  expect((await kill(request("kill", device.token))).status).toBe(200);
  expect(killSwitchOn(db)).toBe(true);
  expect(commandMayContinue(db, command)).toBe(false);
  expect(await (await poll(request("poll", device.token))).json()).toEqual({ command: null, killed: true });
  expect((await kill(request("kill"))).status).toBe(401);
  setKillSwitch(db, false, "owner");
  expect(killSwitchOn(db)).toBe(false);
});
