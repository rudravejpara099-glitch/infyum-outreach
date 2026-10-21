import { afterEach, expect, it, vi } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { assertProductionSecret, DEFAULT_SESSION_SECRET } from "@/lib/auth/production-secret";
import nextConfig from "../next.config";
afterEach(() => vi.unstubAllEnvs());
it("refuses blank, short and publicly shipped default secrets without echoing them", () => {
  for (const value of [undefined, "", "short", " ".repeat(40), DEFAULT_SESSION_SECRET, "change-me-to-a-long-random-string"]) expect(() => assertProductionSecret(value)).toThrow("SESSION_SECRET");
});
it("accepts an explicitly configured long secret", () => {
  expect(() => assertProductionSecret("fixture-only-long-secret-0123456789abcdef")).not.toThrow();
});
it("rejects production server startup while allowing development and build without a secret", () => {
  vi.stubEnv("SESSION_SECRET", undefined);
  expect(() => nextConfig(PHASE_PRODUCTION_SERVER)).toThrow("SESSION_SECRET");
  expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).not.toThrow();
  expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
});
it("retains native SQLite externalization when production startup is configured", () => {
  vi.stubEnv("SESSION_SECRET", "fixture-only-long-secret-0123456789abcdef");
  expect(nextConfig(PHASE_PRODUCTION_SERVER).serverExternalPackages).toContain("better-sqlite3");
});
