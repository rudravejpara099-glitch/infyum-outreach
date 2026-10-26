import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { bindAccountDevice, createDeviceCommand, claimDeviceCommand, completeDeviceCommand, getDeviceCommand, cancelDeviceCommand, requestDeviceCallback, respondDeviceCallback } from "@/lib/connectors/commands";
import { canRequestConnectorComment, connectorKindAllowed, validConnectorArgs, validConnectorResult } from "@/lib/domain/connector";
let db: Db;
let device: string;
function job(type: string, account = 1): number {
  return Number(db.prepare("INSERT INTO jobs(type,account_id,status) VALUES (?,?,'running')").run(type, account).lastInsertRowid);
}
const send = (jobId = job("send"), now = 0) => createDeviceCommand(db, { deviceId: device, accountId: 1, jobId, kind: "sendMessages", args: { handle: "prospect", parts: ["Hello"] } }, now);
beforeEach(() => {
  db = openDb(":memory:"); device = randomUUID();
  db.prepare("INSERT INTO ig_accounts(id,handle,profile_dir) VALUES (1,'sender','unused'),(2,'other','unused')").run();
  bindAccountDevice(db, 1, device);
});
afterEach(() => db.close());
it("claims a command once, rejects cross-device completion and never recreates writes", () => {
  const command = send();
  expect(claimDeviceCommand(db, "other", 1)).toBeNull();
  expect(claimDeviceCommand(db, device, 1)?.id).toBe(command.id);
  expect(claimDeviceCommand(db, device, 2)).toBeNull();
  expect(completeDeviceCommand(db, "other", command.id, null, undefined, 3)).toBe(false);
  expect(completeDeviceCommand(db, device, command.id, null, undefined, 3)).toBe(true);
  expect(completeDeviceCommand(db, device, command.id, null, undefined, 4)).toBe(false);
  expect(() => send(command.jobId, 5)).toThrow("already exists");
});
it("requires an active matching job, allowed kind and current device binding", () => {
  expect(() => send(job("qualify"))).toThrow("active account task");
  expect(() => send(job("send", 2))).toThrow();
  const id = job("send"); db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(id);
  expect(() => send(id)).toThrow();
  const command = send();
  expect(() => bindAccountDevice(db, 1, randomUUID(), 1)).toThrow("current account task");
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(command.jobId);
  expect(claimDeviceCommand(db, device, 1)).toBeNull();
});
it("holds expired or failed running writes as uncertain without replay", () => {
  const command = send(); claimDeviceCommand(db, device, 1);
  expect(completeDeviceCommand(db, device, command.id, null, undefined, command.expiresAt)).toBe(false);
  expect(getDeviceCommand(db, command.id)?.status).toBe("uncertain");
  expect(claimDeviceCommand(db, device, command.expiresAt + 1)).toBeNull();
  const second = send(undefined, 1_000_000); claimDeviceCommand(db, device, 1_000_001);
  expect(completeDeviceCommand(db, device, second.id, null, "Browser disconnected", 1_000_002)).toBe(true);
  expect(getDeviceCommand(db, second.id)?.status).toBe("uncertain");
});
it("cancels queued writes without uncertainty and running writes with uncertainty", () => {
  const queued = send(); cancelDeviceCommand(db, queued.id, "Cancelled", 1);
  expect(getDeviceCommand(db, queued.id)?.status).toBe("failed");
  const running = send(); claimDeviceCommand(db, device, 1); cancelDeviceCommand(db, running.id, "Cancelled", 2);
  expect(getDeviceCommand(db, running.id)?.status).toBe("uncertain");
});
it("round trips a bounded warmup writing callback exactly once while its source job is active", () => {
  const command = createDeviceCommand(db, { deviceId: device, accountId: 1, jobId: job("warmup"), kind: "warmUp", args: { handle: "prospect", pieces: 10 } }, 0);
  claimDeviceCommand(db, device, 1);
  expect(requestDeviceCallback(db, "other", command.id, "one", "Post context", 2)).toBe(false);
  expect(requestDeviceCallback(db, device, command.id, "one", "Post context", 2)).toBe(true);
  expect(respondDeviceCallback(db, command.id, "wrong", "Great post", 3)).toBe(false);
  expect(respondDeviceCallback(db, command.id, "one", "Great post", 3)).toBe(true);
  expect(respondDeviceCallback(db, command.id, "one", "Duplicate", 4)).toBe(false);
  expect(getDeviceCommand(db, command.id)?.callbackResponse).toEqual({ id: "one", response: "Great post" });
  expect(requestDeviceCallback(db, device, command.id, "two", "Next post", 5)).toBe(true);
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(command.jobId);
  expect(respondDeviceCallback(db, command.id, "two", "Stale", 6)).toBe(false);
});
it("limits generated comments to the requested posts without charging duplicate pending requests", () => {
  const command = createDeviceCommand(db, { deviceId: device, accountId: 1, jobId: job("warmup"), kind: "warmUp", args: { handle: "prospect", pieces: 2 } }, 0);
  claimDeviceCommand(db, device, 1);
  expect(requestDeviceCallback(db, device, command.id, "first", "Post one", 2)).toBe(true);
  expect(requestDeviceCallback(db, device, command.id, "first", "Post one", 3)).toBe(true);
  expect(requestDeviceCallback(db, device, command.id, "other", "Post one", 3)).toBe(false);
  respondDeviceCallback(db, command.id, "first", "A valid comment", 4);
  expect(requestDeviceCallback(db, device, command.id, "second", "Post two", 5)).toBe(true);
  respondDeviceCallback(db, command.id, "second", "Another valid comment", 6);
  expect(requestDeviceCallback(db, device, command.id, "third", "Not requested", 7)).toBe(false);
  expect(db.prepare("SELECT value FROM settings WHERE key=?").get(`device_callback_count_${command.id}`)).toEqual({ value: "2" });
});
it("does not acknowledge a stale pending callback after its job or device binding changes", () => {
  const command = createDeviceCommand(db, { deviceId: device, accountId: 1, jobId: job("warmup"), kind: "warmUp", args: { handle: "prospect", pieces: 10 } }, 0);
  claimDeviceCommand(db, device, 1);
  expect(requestDeviceCallback(db, device, command.id, "first", "Post one", 2)).toBe(true);
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(command.jobId);
  expect(requestDeviceCallback(db, device, command.id, "first", "Post one", 3)).toBe(false);
  db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(command.jobId);
  db.prepare("UPDATE account_devices SET device_id=? WHERE account_id=1").run(randomUUID());
  expect(requestDeviceCallback(db, device, command.id, "first", "Post one", 4)).toBe(false);
});
it("uses a pure bounded comment allowance and rejects malformed counters", () => {
  expect(canRequestConnectorComment(10, 0)).toBe(true);
  expect(canRequestConnectorComment(10, 9)).toBe(true);
  for (const [pieces, issued] of [[10, 10], [0, 0], [11, 0], [1, -1], [2, 0.5], [2, NaN], ["2", 0]]) {
    expect(canRequestConnectorComment(pieces, issued as number)).toBe(false);
  }
});
it("validates protocol operation shapes rather than accepting arbitrary instructions or paths", () => {
  expect(validConnectorArgs("readFacts", { handle: "https://evil.example" })).toBe(false);
  expect(validConnectorArgs("openLogin", { profileDir: "/private" })).toBe(false);
  expect(validConnectorArgs("warmUp", { handle: "lead", pieces: 11 })).toBe(false);
  expect(validConnectorArgs("sendMessages", { handle: "lead", parts: ["x".repeat(2001)] })).toBe(false);
  expect(validConnectorResult("readInbox", [{ handle: "valid", text: "Hi" }])).toBe(true);
  expect(validConnectorResult("readFacts", { isPublic: true, followers: -1, country: null, linkedToInfyum: false })).toBe(false);
  expect(validConnectorResult("warmUp", { likes: 11, comments: 0, followed: true })).toBe(false);
  expect(connectorKindAllowed("search", "sendMessages")).toBe(false);
});
it("expires queued work without executing and refuses stale or malformed completions", () => {
  const pending = send();
  expect(claimDeviceCommand(db, device, pending.expiresAt)).toBeNull();
  expect(getDeviceCommand(db, pending.id)?.status).toBe("failed");
  const read = createDeviceCommand(db, { deviceId: device, accountId: 1, jobId: job("qualify"), kind: "readFacts", args: { handle: "lead" } }, 1_000_000);
  claimDeviceCommand(db, device, 1_000_001);
  expect(() => completeDeviceCommand(db, device, read.id, { followers: "oops" }, undefined, 1_000_002)).toThrow("Invalid device task result");
  db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(read.jobId);
  expect(completeDeviceCommand(db, device, read.id, { isPublic: true, followers: 5000, country: null, linkedToInfyum: false }, undefined, 1_000_003)).toBe(false);
});
it("serializes tasks on the same signed-in device", () => {
  const first = send();
  const second = send();
  expect(claimDeviceCommand(db, device, 1)).not.toBeNull();
  expect(claimDeviceCommand(db, device, 2)).toBeNull();
  cancelDeviceCommand(db, first.id, "Stop", 3);
  cancelDeviceCommand(db, second.id, "Stop", 3);
  expect(claimDeviceCommand(db, device, 4)).toBeNull();
});
it("permits failed read-only work only on a later source-job attempt and refuses write replay", () => {
  const readJob = job("qualify");
  const input = { deviceId: device, accountId: 1, jobId: readJob, kind: "readFacts" as const, args: { handle: "lead" } };
  const first = createDeviceCommand(db, input, 0);
  expect(createDeviceCommand(db, input, 1).id).toBe(first.id);
  claimDeviceCommand(db, device, 2);
  completeDeviceCommand(db, device, first.id, null, "Network failure", 3);
  expect(createDeviceCommand(db, input, 4).id).toBe(first.id);
  db.prepare("UPDATE jobs SET attempts=attempts+1 WHERE id=?").run(readJob);
  const second = createDeviceCommand(db, input, 5);
  expect(second.id).not.toBe(first.id);
  expect(second.jobAttempt).toBe(1);
  cancelDeviceCommand(db, second.id, "Stop", 6);
  const write = send(undefined, 7);
  cancelDeviceCommand(db, write.id, "Stop", 8);
  db.prepare("UPDATE jobs SET attempts=attempts+1 WHERE id=?").run(write.jobId);
  expect(() => send(write.jobId, 9)).toThrow("already exists");
  expect(connectorKindAllowed("check_inbox", "openLogin")).toBe(true);
});
it.each(["queued", "running"])("lets expired %s work release a device binding without discarding uncertain writes", state => {
  const command = send();
  if (state === "running") claimDeviceCommand(db, device, 1);
  const replacement = randomUUID();
  bindAccountDevice(db, 1, replacement, command.expiresAt);
  expect(db.prepare("SELECT device_id FROM account_devices WHERE account_id=1").get()).toEqual({ device_id: replacement });
  expect(getDeviceCommand(db, command.id)?.status).toBe(state === "running" ? "uncertain" : "failed");
});
it.each(["done", "failed", "queued", "new attempt"])("retires an orphaned device command after its source is %s", source => {
  const command = send();
  claimDeviceCommand(db, device, 1);
  if (source === "new attempt") db.prepare("UPDATE jobs SET attempts=attempts+1 WHERE id=?").run(command.jobId);
  else db.prepare("UPDATE jobs SET status=? WHERE id=?").run(source, command.jobId);
  bindAccountDevice(db, 1, randomUUID(), 2);
  expect(getDeviceCommand(db, command.id)?.status).toBe("uncertain");
  expect(getDeviceCommand(db, command.id)?.error).toContain("no longer active");
  expect(completeDeviceCommand(db, device, command.id, null, undefined, 3)).toBe(false);
});
it("does not let an orphaned queued command or completed read block reconnection forever", () => {
  const command = send();
  db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(command.jobId);
  bindAccountDevice(db, 1, randomUUID(), 1);
  expect(getDeviceCommand(db, command.id)?.status).toBe("failed");
});
it("continues protecting a live write and keeps its existing device binding", () => {
  const command = send();
  claimDeviceCommand(db, device, 1);
  expect(() => bindAccountDevice(db, 1, randomUUID(), 2)).toThrow("current account task");
  expect(getDeviceCommand(db, command.id)?.status).toBe("running");
  expect(db.prepare("SELECT device_id FROM account_devices WHERE account_id=1").get()).toEqual({ device_id: device });
});
it("retries a failed read on a rebound device only after its source advances, with unchanged arguments", () => {
  const readJob = job("qualify");
  const input = { deviceId: device, accountId: 1, jobId: readJob, kind: "readFacts" as const, args: { handle: "lead" } };
  const first = createDeviceCommand(db, input, 0);
  claimDeviceCommand(db, device, 1);
  completeDeviceCommand(db, device, first.id, null, "Old device disconnected", 2);
  const replacement = randomUUID();
  bindAccountDevice(db, 1, replacement, 3);
  expect(() => createDeviceCommand(db, { ...input, deviceId: replacement }, 4)).toThrow("device task changed");
  db.prepare("UPDATE jobs SET attempts=attempts+1 WHERE id=?").run(readJob);
  expect(() => createDeviceCommand(db, { ...input, deviceId: replacement, args: { handle: "different" } }, 5)).toThrow("device task changed");
  const retry = createDeviceCommand(db, { ...input, deviceId: replacement }, 6);
  expect(retry.id).not.toBe(first.id);
  expect(retry.deviceId).toBe(replacement);
  expect(retry.jobAttempt).toBe(first.jobAttempt + 1);
  expect(claimDeviceCommand(db, device, 7)).toBeNull();
  expect(claimDeviceCommand(db, replacement, 7)?.id).toBe(retry.id);
  expect(completeDeviceCommand(db, device, retry.id, { isPublic: true, followers: 5000, linkedToInfyum: false, country: null }, undefined, 8)).toBe(false);
});
it("does not let rebinding replay completed reads or uncertain writes on later attempts", () => {
  const readJob = job("qualify");
  const readInput = { deviceId: device, accountId: 1, jobId: readJob, kind: "readFacts" as const, args: { handle: "lead" } };
  const read = createDeviceCommand(db, readInput, 0);
  claimDeviceCommand(db, device, 1);
  completeDeviceCommand(db, device, read.id, { isPublic: true, followers: 5000, linkedToInfyum: false, country: null }, undefined, 2);
  const write = send(undefined, 3);
  claimDeviceCommand(db, device, 4);
  cancelDeviceCommand(db, write.id, "Review possible send", 5);
  const replacement = randomUUID(); bindAccountDevice(db, 1, replacement, 6);
  db.prepare("UPDATE jobs SET attempts=attempts+1").run();
  expect(() => createDeviceCommand(db, { ...readInput, deviceId: replacement }, 7)).toThrow("already completed");
  expect(() => createDeviceCommand(db, { deviceId: replacement, accountId: 1, jobId: write.jobId, kind: "sendMessages", args: { handle: "prospect", parts: ["Hello"] } }, 7)).toThrow("already exists");
  expect(getDeviceCommand(db, write.id)?.status).toBe("uncertain");
});
