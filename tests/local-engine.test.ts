import { afterEach, expect, it, vi } from "vitest";
import { LocalEngine } from "@/lib/engine/local";
import { AnthropicEngine } from "@/lib/engine/anthropic";
import { defaultEngine } from "@/lib/engine";
import { aiProvider, isInstalledLocalModel, localAiModel, localOutputLimit, localRequestOutputLimit, localMessageFormat } from "@/lib/domain/local-ai";
import type { MeteredAiCall } from "@/lib/engine/types";
const json = (value: unknown) => Response.json(value);
const installedModel = (name = "qwen3:4b") => ({ name, size: 2_600_000_000, details: { format: "gguf" } });
const installed = () => json({ models: [installedModel()] });
const generating = (response: Response) => vi.fn<typeof fetch>().mockResolvedValueOnce(installed()).mockResolvedValueOnce(response);
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("constrains local JSON to three first-message parts or one follow-up part", async () => {
  expect(localMessageFormat()).toBeUndefined();
  expect(localMessageFormat("dm")?.properties.parts).toMatchObject({ minItems: 3, maxItems: 3 });
  expect(localMessageFormat("followup")?.properties.parts).toMatchObject({ minItems: 1, maxItems: 1 });
  const fetcher = generating(json({ done: true, message: { content: '{"parts":["one","two","three"]}' } }));
  await new LocalEngine({ model: "qwen3:4b", fetcher }).complete({ system: "s", prompt: "p", format: "dm" });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).format).toMatchObject({ required: ["parts"], additionalProperties: false, properties: { parts: { minItems: 3, maxItems: 3 } } });
});
it("bounds free comments independently of billing without exceeding a metered allowance", async () => {
  expect(localRequestOutputLimit(160)).toBe(160);
  expect(localRequestOutputLimit(undefined, 2000)).toBe(2000);
  expect(localRequestOutputLimit(300, 160)).toBe(160);
  expect(() => localRequestOutputLimit(0, 160)).toThrow();
  const fetcher = generating(json({ done: true, message: { content: "A clear checklist helps 🙌" } }));
  await new LocalEngine({ model: "qwen3:4b", fetcher }).complete({ system: "s", prompt: "p", maxOutputTokens: 160 });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).options.num_predict).toBe(160);
});
it("never accepts a local response truncated at its output limit", async () => {
  const fetcher = generating(json({ done: true, done_reason: "length", message: { content: "unfinished" } }));
  await expect(new LocalEngine({ model: "qwen3:4b", fetcher }).complete({ system: "s", prompt: "p" })).rejects.toThrow("No incomplete text");
});
it("uses Anthropic by default and local only when explicitly selected, without unknown-provider fallback", () => {
  vi.stubEnv("AI_PROVIDER", ""); expect(defaultEngine()).toBeInstanceOf(AnthropicEngine);
  vi.stubEnv("AI_PROVIDER", "local"); expect(defaultEngine()).toBeInstanceOf(LocalEngine);
  vi.stubEnv("AI_PROVIDER", "typo"); expect(() => defaultEngine()).toThrow("No fallback");
});
it("requires an exact installed model before any preparation and uses fixed loopback endpoints", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(installed());
  const engine = new LocalEngine({ model: "qwen3:4b", fetcher });
  await engine.assertReady();
  expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:11434/api/tags", expect.objectContaining({ method: "GET", redirect: "error" }));
  fetcher.mockResolvedValue(json({ models: [installedModel("qwen3:8b")] }));
  await expect(engine.assertReady()).rejects.toThrow("not installed");
});
it("rejects absent model, URL-shaped models and invalid output limits without fetching", async () => {
  const fetcher = vi.fn<typeof fetch>(); vi.stubEnv("LOCAL_AI_MODEL", "");
  await expect(new LocalEngine({ fetcher }).assertReady()).rejects.toThrow("LOCAL_AI_MODEL");
  for (const model of ["https://paid.example/model", "../model", "model\nkey", "x".repeat(101), "gpt-oss:120b-cloud", "minimax:cloud", "model-cloud:latest", "CLOUD", "model:cloud-latest"]) expect(() => localAiModel(model)).toThrow();
  for (const value of [0, 2001, Infinity, 1.5]) expect(() => localOutputLimit(value)).toThrow();
  expect(localOutputLimit(undefined)).toBe(1200); expect(aiProvider(undefined)).toBe("anthropic");
  expect(fetcher).not.toHaveBeenCalled();
});
it("writes using system and user messages with bounded output and no credentials or billable ledger", async () => {
  const fetcher = generating(json({ done: true, message: { content: '  {"parts":["Hello"]}  ' } }));
  const engine = new LocalEngine({ model: "qwen3:4b", fetcher });
  const response = await engine.complete({ system: "Only JSON", prompt: "Draft a comment" });
  expect(response).toBe('{"parts":["Hello"]}');
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/tags");
  const [url, init] = fetcher.mock.calls[1]; expect(url).toBe("http://127.0.0.1:11434/api/chat");
  expect(init?.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(String(init?.body))).toEqual({ model: "qwen3:4b", messages: [{ role: "system", content: "Only JSON" }, { role: "user", content: "Draft a comment" }], stream: false, think: false, options: { num_predict: 1200, num_ctx: 16384, temperature: 0.2 } });
});
it("honors metering output allowance without reading or writing paid metering state", async () => {
  const fetcher = generating(json({ done: true, message: { content: "Comment" } }));
  const db = new Proxy({}, { get() { throw new Error("Local writing must not touch paid billing"); } });
  await new LocalEngine({ model: "qwen3:4b", fetcher }).complete({ system: "s", prompt: "p", metering: { db, maxOutputTokens: 180 } as MeteredAiCall });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).options.num_predict).toBe(180);
});
it("bounds the full encoded request and streamed response", async () => {
  const fetcher = vi.fn<typeof fetch>(); const engine = new LocalEngine({ model: "qwen3:4b", fetcher });
  await expect(engine.complete({ system: "s", prompt: "x".repeat(30_000) })).rejects.toThrow("input limit");
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(installed()).mockResolvedValueOnce(new Response("x".repeat(20_001)));
  await expect(engine.complete({ system: "s", prompt: "p" })).rejects.toThrow("invalid response");
});
it.each([new Response("invalid-json"), new Response("failed", { status: 500 }), json({ done: false, message: { content: "partial" } }), json({ done: true, message: { content: "  " } })])("fails closed on unavailable or incomplete local results", async response => {
  const fetcher = generating(response);
  await expect(new LocalEngine({ model: "qwen3:4b", fetcher }).complete({ system: "s", prompt: "p" })).rejects.toThrow("No paid provider was used");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("aborts stalled local generation and rejects timeout overrides above two minutes", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(installed()).mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
  const engine = new LocalEngine({ model: "qwen3:4b", fetcher });
  const pending = engine.complete({ system: "s", prompt: "p" });
  const rejected = expect(pending).rejects.toThrow("No paid provider was used");
  await vi.advanceTimersByTimeAsync(120_000); await rejected;
  await expect(engine.complete({ system: "s", prompt: "p", timeoutMs: 120_001 })).rejects.toThrow("at most");
});
it.each([
  { ...installedModel(), remote_host: "https://ollama.com" },
  { ...installedModel(), remote_model: "paid-model" },
  { ...installedModel(), remote_host: "" },
  { ...installedModel(), size: 0 },
  { ...installedModel(), size: -1 },
  { ...installedModel(), details: { format: "remote" } },
  { name: "qwen3:4b" },
])("never sends a prompt when exact-name metadata is cloud-backed or unverified", async model => {
  expect(isInstalledLocalModel(model, "qwen3:4b")).toBe(false);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ models: [model] }));
  await expect(new LocalEngine({ model: "qwen3:4b", fetcher }).complete({ system: "private system", prompt: "private prompt" })).rejects.toThrow("verified local model");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/tags");
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
});
it("rechecks local metadata before each generation instead of trusting a cached model name", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(installed())
    .mockResolvedValueOnce(json({ done: true, message: { content: "Local response" } }))
    .mockResolvedValueOnce(json({ models: [{ ...installedModel(), remote_model: "cloud-alias" }] }));
  const engine = new LocalEngine({ model: "qwen3:4b", fetcher });
  await expect(engine.complete({ system: "s", prompt: "first" })).resolves.toBe("Local response");
  await expect(engine.complete({ system: "s", prompt: "second" })).rejects.toThrow("verified local model");
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    "http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/chat", "http://127.0.0.1:11434/api/tags",
  ]);
});
it("bounds installed-model metadata separately from generated text", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ models: [installedModel()], description: "x".repeat(25_000) }));
  await new LocalEngine({ model: "qwen3:4b", fetcher }).assertReady();
  fetcher.mockResolvedValue(new Response("x".repeat(128_001)));
  await expect(new LocalEngine({ model: "qwen3:4b", fetcher }).assertReady()).rejects.toThrow("invalid response");
});
it("waits for asynchronous local readiness before allowing any Instagram engagement", async () => {
  const { openDb } = await import("@/lib/db/core");
  const { runOne } = await import("@/worker/runner");
  const db = openDb(":memory:");
  try {
    db.exec(`INSERT INTO ig_accounts(id,handle,profile_dir,ramp_start) VALUES (1,'sender','unused','2020-01-01');
      INSERT INTO campaigns(id,name,status) VALUES (1,'Campaign','active');
      INSERT INTO campaign_accounts(campaign_id,account_id) VALUES (1,1);
      INSERT INTO leads(id,handle,campaign_id,account_id,stage) VALUES (1,'lead',1,1,'qualified');
      INSERT INTO jobs(type,lead_id,account_id) VALUES ('warmup',1,1);`);
    const warmUp = vi.fn().mockResolvedValue({ likes: 10, comments: 10, followed: true });
    const driver = { openLogin: vi.fn().mockResolvedValue(true), readFacts: vi.fn(), readProfileNotes: vi.fn(), warmUp, sendMessages: vi.fn(), readInbox: vi.fn() };
    const engine = new LocalEngine({ model: "qwen3:4b", fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("offline", { status: 503 })) });
    await runOne({ db, engine, driver, now: () => new Date("2026-10-20T10:00:00Z"), pace: async () => {} });
    expect(warmUp).not.toHaveBeenCalled();
    expect(db.prepare("SELECT stage FROM leads WHERE id=1").get()).toEqual({ stage: "qualified" });
  } finally { db.close(); }
});
