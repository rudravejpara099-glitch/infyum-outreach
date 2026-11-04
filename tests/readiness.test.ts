import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { setSetting } from "@/lib/db/repos/settings";
import { evaluateReadiness, type Check } from "@/lib/services/readiness";
import { setupClaude } from "@/lib/services/setup-claude";
import { saveRefreshToken } from "@/lib/sheets/connection";

let db: Db;
const NOW = Date.parse("2026-11-04T10:00:00Z");
const find = (checks: Check[], area: Check["area"], text: RegExp) => checks.find((c) => c.area === area && text.test(c.message));
const fetchOk = (models = ["claude-sonnet-5-5"]) => vi.fn(async (url: string | URL | Request) => {
  const u = String(url);
  return { status: 200, json: async () => (u.includes("anthropic") ? { data: models.map((id) => ({ id })) } : { data: { username: "rudra" } }) } as Response;
}) as unknown as typeof fetch;
const fetchStatus = (status: number) => vi.fn(async () => ({ status, json: async () => ({}) } as Response)) as unknown as typeof fetch;
const goodEnv = { SESSION_SECRET: "x".repeat(40), ANTHROPIC_API_KEY: "k", APIFY_TOKEN: "t", GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s" };

beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());

function fullyReady() {
  const userId = createUser(db, "o@test.invalid", "O", "fake").id;
  const acct = createAccount(db, { handle: "sender", profileDir: "/tmp/s" }, "t");
  createCampaign(db, { name: "C", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 9, approvalRequired: true, followupsEnabled: false }, [acct.id], "t");
  expect(setupClaude(db, { userId, limitUsd: "10", apifyCapUsd: "5", commitSha: "abc1234" }).ok).toBe(true);
  setSetting(db, "device_seen_d1", String(NOW - 5000));
  saveRefreshToken(db, "rt", "s".repeat(40)); setSetting(db, "sheet_id", "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBc");
}

describe("readiness check", () => {
  it("on a bare machine lists every missing key and says how to fix each one", async () => {
    const checks = await evaluateReadiness({ env: { AI_PROVIDER: "local" }, db, fetchImpl: fetchOk(), appUp: false, nowMs: NOW });
    for (const [area, text] of [["App", /not running/], ["App", /SESSION_SECRET/], ["Instagram", /No Instagram account/], ["Claude", /small local model/], ["Claude", /No Anthropic API key/], ["Apify", /No Apify token/], ["Apify", /No monthly lead-search limit/], ["Google", /client id and secret are missing/], ["Google", /not connected/]] as const) {
      const c = find(checks, area, text);
      expect(c, `${area}: ${text}`).toBeTruthy();
      expect(c!.status).toBe("todo");
      expect(c!.fix).toBeTruthy();
    }
  });
  it("with every key working and the setup done, nothing is left to do", async () => {
    fullyReady();
    const checks = await evaluateReadiness({ env: goodEnv, db, fetchImpl: fetchOk(), appUp: true, nowMs: NOW });
    expect(checks.filter((c) => c.status === "todo")).toEqual([]);
    expect(find(checks, "Claude", /Anthropic key works/)?.status).toBe("ok");
    expect(find(checks, "Apify", /token works \(rudra\)/)?.status).toBe("ok");
    expect(find(checks, "Claude", /payer for every campaign/)?.status).toBe("ok");
    expect(find(checks, "Instagram", /extension is online/)?.status).toBe("ok");
  });
  it("tests the Claude key with a free call that carries the key and no message", async () => {
    fullyReady();
    const f = fetchOk();
    await evaluateReadiness({ env: goodEnv, db, fetchImpl: f, appUp: true, nowMs: NOW });
    const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const claude = calls.find(([u]) => u.includes("anthropic"))!;
    expect(claude[0]).toBe("https://api.anthropic.com/v1/models?limit=100");
    expect((claude[1].headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(claude[1].method).toBeUndefined();
    expect(claude[1].body).toBeUndefined();
  });
  it("says a refused key or token is refused, and an unreachable service is a note, not a failure of the key", async () => {
    fullyReady();
    const refused = await evaluateReadiness({ env: goodEnv, db, fetchImpl: fetchStatus(401), appUp: true, nowMs: NOW });
    expect(find(refused, "Claude", /refused this key/)?.status).toBe("todo");
    expect(find(refused, "Apify", /refused this token/)?.status).toBe("todo");
    const down = await evaluateReadiness({ env: goodEnv, db, fetchImpl: vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch, appUp: true, nowMs: NOW });
    expect(find(down, "Claude", /Could not reach Anthropic/)?.status).toBe("warn");
    expect(find(down, "Apify", /Could not reach Apify/)?.status).toBe("warn");
  });
  it("notes a stopped system, pacing switched off, a stale extension and a model the key cannot see", async () => {
    fullyReady();
    setSetting(db, "kill_switch", "2026-11-04T09:00:00Z"); setSetting(db, "device_seen_d1", String(NOW - 600_000));
    const checks = await evaluateReadiness({ env: { ...goodEnv, HUMAN_PACING: "off" }, db, fetchImpl: fetchOk(["some-other-model"]), appUp: true, nowMs: NOW });
    expect(find(checks, "App", /Everything is stopped/)?.status).toBe("warn");
    expect(find(checks, "App", /pacing is switched OFF/)?.status).toBe("warn");
    expect(find(checks, "Instagram", /last checked in 10 minutes ago/)?.status).toBe("warn");
    expect(find(checks, "Claude", /does not list the model claude-sonnet-5-5/)?.status).toBe("warn");
  });
  it("never puts a key into its own output", async () => {
    fullyReady();
    const text = JSON.stringify(await evaluateReadiness({ env: { ...goodEnv, ANTHROPIC_API_KEY: "sk-ant-SECRET123", APIFY_TOKEN: "apify_api_SECRET456", GOOGLE_CLIENT_SECRET: "GOCSPX-SECRET789" }, db, fetchImpl: fetchOk(), appUp: true, nowMs: NOW }));
    for (const secret of ["SECRET123", "SECRET456", "SECRET789"]) expect(text).not.toContain(secret);
  });
});
