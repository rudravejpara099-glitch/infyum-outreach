import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialFile, parseConnectionCode, serverOrigin } from "../companion/connection";
import { ConnectorRuntime } from "../companion/runtime";
import { InstagramBlockedError, type InstagramDriver } from "../worker/driver";
import type { WireCommand } from "../lib/connectors/protocol";

const credential = { origin: "https://outreach.example", token: "private-bearer", device: { id: "device", workspaceId: "company", userId: 1, label: "My Mac", lastSeen: 1 } };
const command = (kind: WireCommand["kind"], args: Record<string, unknown> = {}): WireCommand => ({ id: "task", kind, args, expiresAt: Date.now() + 30_000, account: { id: 8, handle: "my.company" } });
const driver = (): InstagramDriver => ({ openLogin: vi.fn().mockResolvedValue(true), readFacts: vi.fn(), readProfileNotes: vi.fn(), readInbox: vi.fn().mockResolvedValue([]), warmUp: vi.fn(), sendMessages: vi.fn() });
function fakeServer(task: WireCommand) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let claimed = false;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ path, body });
    if (path.endsWith("poll")) return Response.json(body.commandId ? { continue: true, command: task } : { command: claimed ? null : (claimed = true, task) });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return { fetcher, requests };
}
describe("customer connector", () => {
  it("accepts only exact HTTPS origins or local development origins", () => {
    expect(serverOrigin("https://app.example")).toBe("https://app.example");
    expect(serverOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    for (const value of ["http://app.example", "https://u:p@app.example", "https://app.example/other", "https://app.example?secret=x", "file:///tmp"]) expect(() => serverOrigin(value)).toThrow();
    expect(parseConnectionCode(Buffer.from(JSON.stringify({ origin: "https://app.example", code: "x".repeat(43) })).toString("base64url")).origin).toBe("https://app.example");
  });
  it("stores only scoped device credentials with private filesystem permissions", () => {
    const path = join(mkdtempSync(join(tmpdir(), "companion-")), "private", "device.json"), file = new CredentialFile(path);
    file.save(credential);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(credential);
    expect(file.load()).toEqual(credential);
    file.clear(); expect(file.load()).toBeNull();
  });
  it("pairs without following redirects, using bounded requests and no logs", async () => {
    const logger = vi.spyOn(console, "log");
    const request = vi.fn().mockResolvedValue(Response.json({ token: credential.token, device: credential.device }));
    const save = vi.fn(), runtime = new ConnectorRuntime(driver(), request, Date.now, undefined, save);
    await runtime.pair(credential.origin, "x".repeat(43), "My Mac");
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "POST" });
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(save).toHaveBeenCalledWith(credential); expect(logger).not.toHaveBeenCalled(); logger.mockRestore();
  });
  it("uses sender identity from the fixed command and never exports a profile path", async () => {
    const fake = fakeServer(command("openLogin")), local = driver(), runtime = new ConnectorRuntime(local, fake.fetcher);
    runtime.restore(credential); await runtime.tick();
    expect(local.openLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 8, handle: "my.company", browserMode: "chrome_read_only", profileDir: "" }));
    expect(fake.requests.find(item => item.path.endsWith("result"))?.body).toEqual({ id: "task", result: true });
  });
  it("does not replay a send after an offline result", async () => {
    const fake = fakeServer(command("sendMessages", { handle: "prospect", parts: ["Approved message"] })), local = driver();
    const request: typeof fetch = async (url, init) => {
      if (String(url).endsWith("result")) throw new Error("offline");
      return fake.fetcher(url, init);
    };
    const runtime = new ConnectorRuntime(local, request); runtime.restore(credential);
    await runtime.tick(); await runtime.tick();
    expect(local.sendMessages).toHaveBeenCalledTimes(1);
    expect(local.sendMessages).toHaveBeenCalledWith(expect.anything(), "prospect", ["Approved message"], expect.any(Function));
    expect(runtime.status).not.toContain(credential.token);
  });
  it("refuses unknown and malformed commands before touching Chrome", async () => {
    for (const task of [command("sendMessages", { handle: "../outside", parts: ["x"] }), { ...command("openLogin"), kind: "shell" as WireCommand["kind"] }]) {
      const local = driver(), fake = fakeServer(task), runtime = new ConnectorRuntime(local, fake.fetcher);
      runtime.restore(credential); await runtime.tick();
      for (const method of Object.values(local)) expect(method).not.toHaveBeenCalled();
    }
  });
  it("marks write failures uncertain and preserves verified warning identity", async () => {
    const local = driver(); vi.mocked(local.sendMessages).mockRejectedValue(new InstagramBlockedError("human check"));
    const fake = fakeServer(command("sendMessages", { handle: "prospect", parts: ["Approved"] })), runtime = new ConnectorRuntime(local, fake.fetcher);
    runtime.restore(credential); await runtime.tick();
    expect(fake.requests.find(item => item.path.endsWith("result"))?.body).toEqual({ id: "task", error: "Instagram needs your attention. Review the account in Chrome.", uncertain: true, blockedByInstagram: true });
  });
  it("revocation immediately clears credentials and prevents browser actions", async () => {
    const local = driver(), save = vi.fn(), runtime = new ConnectorRuntime(local, vi.fn().mockResolvedValue(new Response("", { status: 401 })), Date.now, undefined, save);
    runtime.restore(credential); await runtime.tick();
    expect(runtime.isConnected()).toBe(false); expect(save).toHaveBeenCalledWith(null); expect(local.openLogin).not.toHaveBeenCalled();
  });
  it("closing the connector pauses browser work and preserves the saved pairing", async () => {
    const local = driver(), save = vi.fn(), request = vi.fn(), runtime = new ConnectorRuntime(local, request, Date.now, undefined, save);
    runtime.restore(credential); runtime.stop(); await runtime.tick();
    expect(runtime.isConnected()).toBe(true);
    expect(request).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(local.openLogin).not.toHaveBeenCalled();
    expect(runtime.status).toContain("Reopen Outreach Connector");
  });
  it("round-trips warm-up comments only through the active command callback", async () => {
    const task = command("warmUp", { handle: "prospect", pieces: 10 });
    let callbackId = "";
    const request: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("callback")) { callbackId = body.callbackId; return Response.json({ ok: true }); }
      if (String(url).endsWith("poll")) return Response.json({ continue: true, command: { ...task, ...(callbackId ? { callbackResponse: { id: callbackId, response: "Such a lovely thoughtful idea ✨" } } : {}) } });
      return Response.json({ ok: true });
    };
    const local = driver();
    vi.mocked(local.warmUp).mockImplementation(async (_a, _h, _n, comment, mayContinue) => { expect(mayContinue?.()).toBe(true); expect(await comment("Post text")).toBe("Such a lovely thoughtful idea ✨"); return { likes: 10, comments: 10, followed: true }; });
    const runtime = new ConnectorRuntime(local, request); runtime.restore(credential); await runtime.tick();
    expect(callbackId).not.toBe(""); expect(local.warmUp).toHaveBeenCalledTimes(1);
  });
});
it("stops preparation when the cached server authorization becomes stale", async () => {
  let now = 1000;
  const local = driver(), fake = fakeServer(command("warmUp", { handle: "prospect", pieces: 10 }));
  vi.mocked(local.warmUp).mockImplementation(async (_a, _h, _n, _c, mayContinue) => {
    expect(mayContinue?.()).toBe(true); now += 5001; expect(mayContinue?.()).toBe(false); throw new Error("offline");
  });
  const runtime = new ConnectorRuntime(local, fake.fetcher, () => now); runtime.restore(credential); await runtime.tick();
  expect(fake.requests.find(item => item.path.endsWith("result"))?.body).toMatchObject({ uncertain: true });
});
it("confirms current authorization before touching Chrome", async () => {
  const task = command("openLogin"), local = driver();
  const runtime = new ConnectorRuntime(local, async (url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json(String(url).endsWith("poll") ? { continue: !body.commandId, command: body.commandId ? null : task } : { ok: true });
  });
  runtime.restore(credential); await runtime.tick(); expect(local.openLogin).not.toHaveBeenCalled();
});
