import { afterEach, expect, it, vi } from "vitest";
import { writingReadiness } from "@/lib/domain/writing-readiness";
import { getWritingReadiness } from "@/lib/services/writing-readiness";
const state = vi.hoisted(() => ({ assertReady: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/engine/local", () => ({ LocalEngine: class { assertReady = state.assertReady; } }));
afterEach(() => { vi.unstubAllEnvs(); state.assertReady.mockReset(); });
const base = { provider: "local", model: "qwen3:4b", localAvailable: false, paidKeyConfigured: false };
it("does not report configured local writing as connected without an installed-model check", () => {
  expect(writingReadiness(base)).toMatchObject({ available: false, title: "Local writing is unavailable" });
  const available = writingReadiness({ ...base, localAvailable: true });
  expect(available.available).toBe(true); expect(available.detail).toContain("A draft has not been tested");
});
it("distinguishes missing model, missing provider and invalid configuration", () => {
  expect(writingReadiness({ ...base, model: undefined })).toMatchObject({ available: false, title: "Choose a local writing model" });
  expect(writingReadiness({ ...base, provider: undefined })).toMatchObject({ provider: "anthropic", available: false });
  expect(writingReadiness({ ...base, provider: "unknown" })).toMatchObject({ provider: "invalid", available: false });
});
it("labels paid keys as configuration only without claiming verified provider access or billing", () => {
  const ready = writingReadiness({ ...base, provider: "anthropic", paidKeyConfigured: true });
  expect(ready.title).toBe("Paid writing key configured"); expect(ready.detail).toContain("does not confirm provider access or billing readiness");
});
it("checks only the local selected provider, and fails closed when its model is unavailable", async () => {
  vi.stubEnv("AI_PROVIDER", "local"); vi.stubEnv("LOCAL_AI_MODEL", "qwen3:4b");
  state.assertReady.mockRejectedValue(new Error("Not installed"));
  expect((await getWritingReadiness(false)).available).toBe(false);
  state.assertReady.mockResolvedValue(undefined);
  expect((await getWritingReadiness(false)).available).toBe(true);
  expect(state.assertReady).toHaveBeenCalledTimes(2);
});
it("does not probe paid providers or expose host credentials to another workspace", async () => {
  vi.stubEnv("AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "fixture-only");
  expect((await getWritingReadiness(false)).available).toBe(false);
  expect((await getWritingReadiness(true)).title).toBe("Paid writing key configured");
  expect(state.assertReady).not.toHaveBeenCalled();
});
