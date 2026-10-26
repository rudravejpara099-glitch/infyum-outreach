import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { AnthropicEngine, AiUsageUncertainError } from "@/lib/engine/anthropic";
import { saveActiveAiModel, saveModelRate } from "@/lib/billing/admin";

let db: Db;
const source = { campaignId: 1, accountId: 1, leadId: 1, jobId: 9 };
const metering = { db: null as unknown as Db, userId: 1, operationId: "ai:9:draft_dm:1", source, maxOutputTokens: 100 };

function setup(ready = true) {
  process.env.BILLING_OWNER_USER_ID = "1";
  db = openDb(":memory:");
  const now = new Date().toISOString();
  db.exec(`
    INSERT INTO users(id,email,name,password_hash) VALUES(1,'test@example.invalid','Test','hash');
    INSERT INTO ig_accounts(id,handle,profile_dir) VALUES(1,'sender','/tmp/profile');
    INSERT INTO campaigns(id,name,status) VALUES(1,'Test','active');
    INSERT INTO campaign_accounts(campaign_id,account_id) VALUES(1,1);
    INSERT INTO leads(id,handle,campaign_id,account_id) VALUES(1,'lead',1,1);
    INSERT INTO jobs(id,type,lead_id,account_id) VALUES(9,'draft_dm',1,1);
    INSERT INTO jobs(id,type,lead_id,account_id) VALUES(10,'draft_dm',1,1);
    INSERT INTO billing_profiles(user_id,ceiling_micros,consented_at,created_at) VALUES(1,100000000,'${now}','${now}');
    INSERT INTO billing_assignments(resource_kind,resource_id,user_id,assigned_at) VALUES('campaign',1,1,'${now}'),('account',1,1,'${now}');
  `);
  if (ready) db.prepare("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests',?)").run(now);
  metering.db = db;
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => setup());
afterEach(() => { db.close(); delete process.env.BILLING_OWNER_USER_ID; });

describe("metered Anthropic engine", () => {
  it("checks readiness locally without a provider request or cost reservation", () => {
    const fetcher = vi.fn();
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    expect(() => engine.assertReady()).toThrow("metered campaign call");
    expect(() => engine.assertReady(metering)).not.toThrow();
    db.prepare("DELETE FROM billing_integration_ack").run();
    expect(() => engine.assertReady(metering)).toThrow("metering integration is reviewed");
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) n FROM billing_reservations").get()).toEqual({ n: 0 });
  });
  it("settles exact input, output and cache-read usage from a fake response", async () => {
    const fetcher = vi.fn(async () => response({ id: "msg_test_1", model: "claude-sonnet-5-5", content: [{ type: "text", text: "draft" }], usage: { input_tokens: 100, output_tokens: 25, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } }));
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    await expect(engine.complete({ system: "system", prompt: "hello", metering })).resolves.toBe("draft");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((db.prepare("SELECT status,actual_cost_micros FROM billing_reservations WHERE operation_id=?").get(metering.operationId) as { status: string; actual_cost_micros: number })).toEqual({ status: "settled", actual_cost_micros: 451 });
    expect(db.prepare("SELECT kind,quantity,token_category FROM billing_usage_events ORDER BY id").all()).toEqual([
      { kind: "ai_input_tokens", quantity: 100, token_category: "input" },
      { kind: "ai_output_tokens", quantity: 25, token_category: "output" },
      { kind: "ai_input_tokens", quantity: 10, token_category: "cache_read" },
    ]);
  });

  it("uses the owner-selected model and the matching confirmed rate for new drafts", async () => {
    const now = new Date().toISOString();
    saveModelRate(db, 1, { model: "claude-fixture-alternate", inputMicros: 9000000, outputMicros: 25000000, cacheReadMicros: null, cacheWriteMicros: null, source: "https://provider.test/prices", confirmed: true }, now);
    saveActiveAiModel(db, 1, "claude-fixture-alternate");
    let requestedModel = "";
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("api.anthropic.com");
      requestedModel = (JSON.parse(String(init?.body)) as { model: string }).model;
      return response({ id: "msg_test_alt", model: "claude-fixture-alternate", content: [{ type: "text", text: "alternate draft" }], usage: { input_tokens: 100, output_tokens: 25 } });
    });
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    await expect(engine.complete({ system: "system", prompt: "hello", metering })).resolves.toBe("alternate draft");
    expect(requestedModel).toBe("claude-fixture-alternate");
    expect(db.prepare("SELECT model FROM billing_reservations WHERE operation_id=?").get(metering.operationId)).toEqual({ model: "claude-fixture-alternate" });
    expect(db.prepare("SELECT model,unit_cost_micros FROM billing_usage_events ORDER BY id").all()).toEqual([
      { model: "claude-fixture-alternate", unit_cost_micros: 9000000 },
      { model: "claude-fixture-alternate", unit_cost_micros: 25000000 },
    ]);
  });

  it("does not call the provider when the integration review marker is absent", async () => {
    setup(false);
    const fetcher = vi.fn();
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    await expect(engine.complete({ system: "system", prompt: "hello", metering })).rejects.toThrow(/metering integration is reviewed/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) n FROM billing_reservations").get()).toEqual({ n: 0 });
  });

  it("keeps the reservation and never retries a network-unknown call", async () => {
    const fetcher = vi.fn(async () => { throw new Error("network down"); });
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    await expect(engine.complete({ system: "system", prompt: "hello", metering })).rejects.toBeInstanceOf(AiUsageUncertainError);
    expect(() => engine.assertReady(metering)).toThrow(AiUsageUncertainError);
    await expect(engine.complete({ system: "system", prompt: "hello", metering })).rejects.toBeInstanceOf(AiUsageUncertainError);
    await expect(engine.complete({ system: "system", prompt: "hello", metering: { ...metering, operationId: "ai:10:draft_dm:1", source: { ...source, jobId: 10 } } })).rejects.toBeInstanceOf(AiUsageUncertainError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT status FROM billing_reservations WHERE operation_id=?").get(metering.operationId)).toEqual({ status: "held" });
  });

  it("holds an unpriceable cache-write result for owner reconciliation", async () => {
    const fetcher = vi.fn(async () => response({ id: "msg_test_2", model: "claude-sonnet-5-5", content: [{ type: "text", text: "draft" }], usage: { input_tokens: 100, output_tokens: 25, cache_creation_input_tokens: 5 } }));
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    await expect(engine.complete({ system: "system", prompt: "hello", metering })).rejects.toBeInstanceOf(AiUsageUncertainError);
    expect(db.prepare("SELECT status FROM billing_reservations WHERE operation_id=?").get(metering.operationId)).toEqual({ status: "held" });
    expect(db.prepare("SELECT count(*) n FROM billing_usage_events").get()).toEqual({ n: 0 });
  });

  it("requires a metered context and never reveals provider credentials", async () => {
    const fetcher = vi.fn();
    const engine = new AnthropicEngine({ apiKey: "test-only", fetcher });
    await expect(engine.complete({ system: "system", prompt: "hello" })).rejects.toThrow(/metered campaign call/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
