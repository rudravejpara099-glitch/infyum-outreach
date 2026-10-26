import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { bindAccountDevice, getAccountDevice } from "@/lib/connectors/commands";
const state = vi.hoisted(() => ({ db: null as Db | null, requireUser: vi.fn(), getDb: vi.fn(), listDevices: vi.fn(), launch: vi.fn(), createPairing: vi.fn(), phase: "stopped" }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: state.requireUser }));
vi.mock("@/lib/db", () => ({ getDb: state.getDb }));
vi.mock("@/lib/workspaces/storage", () => ({ getIdentityDb: () => "identity", getWorkspacePaths: (id: string) => ({ dbPath: `/companies/${id}/outreach.db`, profilesDir: `/companies/${id}/profiles` }) }));
vi.mock("@/lib/connectors/catalog", () => ({ listDevices: state.listDevices, createPairing: state.createPairing, revokeDevice: vi.fn() }));
vi.mock("@/lib/connectors/start-login", () => ({ launchDeviceLogin: state.launch }));
vi.mock("@/lib/queries/worker-status", () => ({ workerStatus: () => ({ phase: state.phase }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { connectDeviceAccount, pairMyDevice } from "@/app/(app)/accounts/connect/actions";
const deviceId = "12345678-1234-1234-1234-123456789012";
function form() { const value = new FormData(); value.set("workspaceId", "private-company"); value.set("handle", "@MY.Company"); value.set("dailyCap", "10"); value.set("deviceId", deviceId); value.set("browserMode", "chrome_read_only"); return value; }
beforeEach(() => {
  vi.clearAllMocks(); state.db = openDb(":memory:"); state.phase = "stopped";
  state.requireUser.mockResolvedValue({ id: 3, email: "member@example.test", workspaceId: "private-company" });
  state.getDb.mockImplementation(async () => state.db); state.launch.mockReturnValue(true);
  state.listDevices.mockReturnValue([{ id: deviceId, workspaceId: "private-company", userId: 3, label: "My computer", lastSeen: Date.now() }]);
});
afterEach(() => { state.db?.close(); vi.useRealTimers(); });
describe("customer device account connection", () => {
  it("returns the exact server-side pairing expiry without generating a browser command", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T08:00:00Z"));
    state.createPairing.mockReturnValue("single-use-code");
    const value = await pairMyDevice(form());
    expect(value).toMatchObject({ code: "single-use-code", expiresAt: Date.now() + 5 * 60_000 });
    expect(state.createPairing).toHaveBeenCalledWith("identity", 3, "private-company", Date.now());
    expect(state.launch).not.toHaveBeenCalled();
    expect(state.db!.prepare("SELECT count(*) c FROM jobs").get()).toEqual({ c: 0 });
  });
  it("sets account ramp-up by the workspace's calendar date", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T01:00:00Z"));
    state.listDevices.mockReturnValue([{ id: deviceId, lastSeen: Date.now() }]);
    state.db!.prepare("INSERT INTO settings(key,value) VALUES ('team_timezone','America/Los_Angeles')").run();
    await connectDeviceAccount(form());
    expect(state.db!.prepare("SELECT ramp_start FROM ig_accounts").get()).toEqual({ ramp_start: "2026-10-24" });
  });
  it("authenticates and validates the submitted workspace before looking up a device", async () => {
    const input = form(); state.getDb.mockRejectedValue(new Error("This form belongs to another company."));
    await expect(connectDeviceAccount(input)).rejects.toThrow("another company");
    expect(state.requireUser).toHaveBeenCalledOnce(); expect(state.getDb).toHaveBeenCalledWith(input); expect(state.listDevices).not.toHaveBeenCalled();
  });
  it("creates a private scoped account and starts a read-only check when the worker is stopped", async () => {
    const result = await connectDeviceAccount(form());
    expect(result.url).toBe("/accounts");
    expect(state.listDevices).toHaveBeenCalledWith("identity", "private-company");
    const account = state.db!.prepare("SELECT * FROM ig_accounts").get() as { id: number; handle: string; profile_dir: string; browser_mode: string };
    expect(account).toMatchObject({ handle: "my.company", profile_dir: "/companies/private-company/profiles/my.company", browser_mode: "isolated" });
    expect(state.db!.prepare("SELECT device_id FROM account_devices WHERE account_id=?").get(account.id)).toEqual({ device_id: deviceId });
    const job = state.db!.prepare("SELECT id,type,status,attempts FROM jobs").get() as { id: number };
    expect(job).toMatchObject({ type: "open_login", status: "running", attempts: 1 });
    expect(state.launch).toHaveBeenCalledWith(state.db, "private-company", account.id, job.id);
  });
  it.each(["running", "starting", "stopping", "unresponsive", "legacy_running"])("leaves the sign-in job to a %s worker without a duplicate child", async phase => {
    state.phase = phase; await connectDeviceAccount(form());
    expect(state.launch).not.toHaveBeenCalled(); expect(state.db!.prepare("SELECT status,attempts FROM jobs").get()).toEqual({ status: "queued", attempts: 0 });
  });
  it.each(["forged", "foreign", "offline", "never-seen"])("rejects a %s device without saving any account or job", async kind => {
    if (kind === "forged" || kind === "foreign") state.listDevices.mockReturnValue([]);
    else state.listDevices.mockReturnValue([{ id: deviceId, lastSeen: kind === "offline" ? Date.now() - 31_000 : null }]);
    expect((await connectDeviceAccount(form())).error).toContain("Open Outreach Connector");
    expect(state.db!.prepare("SELECT count(*) c FROM ig_accounts").get()).toEqual({ c: 0 });
    expect(state.db!.prepare("SELECT count(*) c FROM jobs").get()).toEqual({ c: 0 }); expect(state.launch).not.toHaveBeenCalled();
  });
  it("rejects duplicate clicks while the existing sign-in task is running", async () => {
    await connectDeviceAccount(form()); const result = await connectDeviceAccount(form());
    expect(result.error).toContain("finishing a task"); expect(state.launch).toHaveBeenCalledOnce();
    expect(state.db!.prepare("SELECT count(*) c FROM jobs").get()).toEqual({ c: 1 });
  });
  it("attaches a previously saved unbound account without resetting its warning, cap, ramp or profile", async () => {
    const account = createAccount(state.db!, { handle: "my.company", profileDir: "/previous/private-profile", dailyCap: 27, rampStart: "2026-09-01" }, "fixture");
    state.db!.prepare("UPDATE ig_accounts SET status='blocked',status_note='Instagram warning: review required' WHERE id=?").run(account.id);
    const before = state.db!.prepare("SELECT * FROM ig_accounts WHERE id=?").get(account.id);
    const queued = enqueue(state.db!, { type: "open_login", accountId: account.id });
    const result = await connectDeviceAccount(form());
    expect(result.url).toBe("/accounts");
    expect(state.db!.prepare("SELECT * FROM ig_accounts WHERE id=?").get(account.id)).toEqual(before);
    expect(getAccountDevice(state.db!, account.id)).toBe(deviceId);
    expect(state.db!.prepare("SELECT count(*) c FROM jobs").get()).toEqual({ c: 1 });
    expect(state.db!.prepare("SELECT status,attempts FROM jobs WHERE id=?").get(queued)).toEqual({ status: "running", attempts: 1 });
    expect(state.launch).toHaveBeenCalledWith(state.db, "private-company", account.id, queued);
  });
  it("reuses an existing queued sign-in without claiming it from the background worker", async () => {
    state.phase = "running";
    const account = createAccount(state.db!, { handle: "my.company", profileDir: "/previous/profile" }, "fixture");
    const queued = enqueue(state.db!, { type: "open_login", accountId: account.id });
    await connectDeviceAccount(form());
    expect(state.db!.prepare("SELECT id,status,attempts FROM jobs").all()).toEqual([{ id: queued, status: "queued", attempts: 0 }]);
    expect(getAccountDevice(state.db!, account.id)).toBe(deviceId);
    expect(state.launch).not.toHaveBeenCalled();
  });
  it("refuses to attach a device while any account job is running", async () => {
    const account = createAccount(state.db!, { handle: "my.company", profileDir: "/previous/profile" }, "fixture");
    const job = enqueue(state.db!, { type: "qualify", accountId: account.id });
    state.db!.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job);
    expect((await connectDeviceAccount(form())).error).toContain("finishing a task");
    expect(getAccountDevice(state.db!, account.id)).toBeNull();
    expect(state.db!.prepare("SELECT count(*) c FROM jobs").get()).toEqual({ c: 1 });
    expect(state.launch).not.toHaveBeenCalled();
  });
  it("sends an already bound account back to its existing connection controls", async () => {
    const account = createAccount(state.db!, { handle: "my.company", profileDir: "/previous/profile" }, "fixture");
    bindAccountDevice(state.db!, account.id, deviceId);
    expect((await connectDeviceAccount(form())).error).toContain("already uses this computer");
    expect(state.launch).not.toHaveBeenCalled();
    expect(state.db!.prepare("SELECT count(*) c FROM jobs").get()).toEqual({ c: 0 });
  });
  it("can reconnect after a previous device was revoked but does not steal an active connection", async () => {
    const previous = "98765432-4321-4321-4321-210987654321";
    const account = createAccount(state.db!, { handle: "my.company", profileDir: "/previous/profile" }, "fixture");
    bindAccountDevice(state.db!, account.id, previous);
    state.listDevices.mockReturnValue([{ id: deviceId, lastSeen: Date.now() }, { id: previous, lastSeen: Date.now() }]);
    expect((await connectDeviceAccount(form())).error).toContain("another connected computer");
    expect(getAccountDevice(state.db!, account.id)).toBe(previous);
    state.listDevices.mockReturnValue([{ id: deviceId, lastSeen: Date.now() }]);
    expect((await connectDeviceAccount(form())).url).toBe("/accounts");
    expect(getAccountDevice(state.db!, account.id)).toBe(deviceId);
  });
  it("keeps the saved account and marks a failed child launch as actionable", async () => {
    state.launch.mockReturnValue(false); const result = await connectDeviceAccount(form());
    expect(result.error).toContain("Account saved"); expect(state.db!.prepare("SELECT status,last_error FROM jobs").get()).toMatchObject({ status: "failed", last_error: expect.stringContaining("Try again") });
  });
});
