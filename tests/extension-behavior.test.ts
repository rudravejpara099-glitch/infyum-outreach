import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Runs the real extension/background.js against a pretend Chrome and a pretend Outreach server.
type Poll = Record<string, unknown>;
let store: Record<string, unknown>;
let posts: { path: string; body: Record<string, unknown>; signal: AbortSignal | null }[];
let alarm: (a: { name: string }) => void;
let reload: ReturnType<typeof vi.fn>;
let opened: string[];
let closed: number[];
let pageResult: unknown;
let server: (path: string, body: Record<string, unknown>) => { status?: number; json?: Poll } | "down";

const command = (kind: string, args: Record<string, unknown> = { handle: "my.acct" }) => ({ id: "c1", kind, args, expiresAt: Date.now() + 60_000 });
const results = () => posts.filter((p) => p.path === "/api/connector/result");

beforeEach(async () => {
  vi.resetModules();
  store = {}; posts = []; opened = []; closed = []; pageResult = { allowed: true, loggedIn: true, text: "Edit profile" };
  reload = vi.fn();
  server = () => ({ json: {} });
  Object.assign(globalThis, {
    chrome: {
      storage: { local: {
        get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map((k) => [k, store[k]])),
        set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
        remove: async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k]; },
      } },
      runtime: { getManifest: () => ({ version: "0.3.2" }), reload, onMessage: { addListener: () => {} }, onStartup: { addListener: () => {} }, onInstalled: { addListener: () => {} } },
      alarms: { create: () => {}, onAlarm: { addListener: (fn: typeof alarm) => { alarm = fn; } } },
      tabs: {
        create: async ({ url }: { url: string }) => { opened.push(url); return { id: 7 }; },
        remove: async (id: number) => { closed.push(id); },
        onUpdated: { addListener: (fn: (id: number, info: { status: string }) => void) => { queueMicrotask(() => fn(7, { status: "complete" })); }, removeListener: () => {} },
      },
      scripting: { executeScript: async () => [{ result: pageResult }] },
    },
    fetch: vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname, body = JSON.parse(String(init.body ?? "{}"));
      posts.push({ path, body, signal: (init.signal as AbortSignal) ?? null });
      const answer = server(path, body);
      if (answer === "down") throw new Error("network down");
      return { ok: (answer.status ?? 200) < 400, status: answer.status ?? 200, json: async () => answer.json ?? {} } as Response;
    }),
  });
  await import(/* @vite-ignore */ resolve("extension/background.js")); // not paired yet, so the first check-in does nothing
  store.credential = { origin: "http://localhost:3000", token: "t" };
});
afterEach(() => { vi.restoreAllMocks(); });

/** One command: the first poll hands it out, the second (with its id) says it may run. */
function serve(cmd: ReturnType<typeof command>) {
  let handed = false;
  server = (path, body) => {
    if (path === "/api/connector/poll") {
      if (body.commandId) return { json: { continue: true, command: cmd } };
      if (!handed) { handed = true; return { json: { command: cmd, extensionVersion: "0.3.2" } }; }
      return { json: { command: null, extensionVersion: "0.3.2" } };
    }
    return { json: {} };
  };
}
const ring = async () => { alarm({ name: "poll" }); };

describe("the sign-in check", () => {
  it("opens the account's own profile in a background tab, answers true when signed in, and closes the tab", async () => {
    serve(command("openLogin"));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(results()[0].body).toEqual({ id: "c1", result: true });
    expect(opened).toEqual(["https://www.instagram.com/my.acct/"]);
    expect(closed).toEqual([7]);
    expect(reload).not.toHaveBeenCalled();
  });
  it("answers false when the profile has no Edit profile button (signed out or another account)", async () => {
    pageResult = { allowed: true, loggedIn: false, text: "Log in Sign up" };
    serve(command("openLogin"));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(results()[0].body).toEqual({ id: "c1", result: false });
  });
  it("reports a lock screen or redirect as a problem to look at, not as 'not signed in'", async () => {
    pageResult = { allowed: false, loggedIn: false };
    serve(command("openLogin"));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(String(results()[0].body.error)).toMatch(/security check/);
    expect(results()[0].body.result).toBeUndefined();
  });
  it("reports warning text on the page as a warning", async () => {
    pageResult = { allowed: true, loggedIn: false, text: "We locked your account to protect you from a possible hack" };
    serve(command("openLogin"));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(String(results()[0].body.error)).toMatch(/warning or human check/);
  });
  it("refuses a handle that is not a plain Instagram handle", async () => {
    serve(command("openLogin", { handle: "../evil" }));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(String(results()[0].body.error)).toMatch(/needs the account's Instagram handle/);
    expect(opened).toEqual([]);
  });
});

describe("commands and safety", () => {
  it("says plainly when it is asked for something it cannot do", async () => {
    serve(command("shellOut"));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(String(results()[0].body.error)).toMatch(/cannot do this action yet/);
    expect(opened).toEqual([]);
  });
  it("does nothing while the kill switch is on", async () => {
    server = () => ({ json: { command: null, killed: true } });
    await ring();
    await vi.waitFor(() => expect(store.status).toBe("Stopped. Resume in Outreach."));
    expect(results()).toHaveLength(0);
    expect(opened).toEqual([]);
  });
  it("does not run a command whose permission check fails", async () => {
    server = (path, body) => (path === "/api/connector/poll" && body.commandId ? { json: { continue: false } } : path === "/api/connector/poll" ? { json: { command: command("openLogin") } } : { json: {} });
    await ring();
    await vi.waitFor(() => expect(posts.filter((p) => p.path === "/api/connector/poll")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(opened).toEqual([]);
    expect(results()).toHaveLength(0);
  });
  it("does not run a command that has already expired", async () => {
    server = (path) => (path === "/api/connector/poll" ? { json: { command: { ...command("openLogin"), expiresAt: Date.now() - 1 } } } : { json: {} });
    await ring();
    await vi.waitFor(() => expect(posts.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(opened).toEqual([]);
    expect(results()).toHaveLength(0);
  });
});

describe("staying connected", () => {
  it("reloads itself when the app ships a newer extension version, with no visit to chrome://extensions", async () => {
    server = () => ({ json: { command: null, extensionVersion: "9.9.9" } });
    await ring();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
  it("gives every call to the app a time limit, so a hung app cannot freeze the extension", async () => {
    serve(command("openLogin"));
    await ring();
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    for (const p of posts) { expect(p.signal).toBeInstanceOf(AbortSignal); expect(p.signal!.aborted).toBe(false); }
  });
  it("says the app is unreachable and keeps its pairing when the network is down", async () => {
    server = () => "down";
    await ring();
    await vi.waitFor(() => expect(store.status).toBe("Outreach is unreachable. Waiting to retry."));
    expect(store.credential).toBeTruthy();
  });
  it("forgets its pairing when the app says the connection was revoked", async () => {
    server = () => ({ status: 401 });
    await ring();
    await vi.waitFor(() => expect(store.credential).toBeUndefined());
    expect(store.status).toBe("This connection was revoked. Create a new code in Accounts.");
  });
});
