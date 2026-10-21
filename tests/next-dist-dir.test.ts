import { describe, expect, it } from "vitest";
import { nextDistDir, nextTsconfigPath } from "@/lib/config/next-dist-dir";

describe("Next build directory selection", () => {
  it("keeps normal app runs on the standard build directory", () => {
    expect(nextDistDir({})).toBe(".next");
  });

  it("accepts an isolated smoke-test directory inside the app", () => {
    expect(nextDistDir({ OUTREACH_SMOKE_DIST_DIR: ".next-smoke-ui-a1b2c3d4" })).toBe(".next-smoke-ui-a1b2c3d4");
  });

  it.each(["../outside", "/tmp/outside", ".next", ".next-smoke-", ".next-smoke-ui/a1b2c3d4"])("rejects unsafe smoke directory %s", value => {
    expect(() => nextDistDir({ OUTREACH_SMOKE_DIST_DIR: value })).toThrow("dedicated .next-smoke-*");
  });

  it("keeps normal type generation on the project config and isolates smoke configs", () => {
    expect(nextTsconfigPath({})).toBe("tsconfig.json");
    expect(nextTsconfigPath({ OUTREACH_SMOKE_TSCONFIG: ".tsconfig-smoke-ui-a1b2c3d4.json" })).toBe(".tsconfig-smoke-ui-a1b2c3d4.json");
    expect(() => nextTsconfigPath({ OUTREACH_SMOKE_TSCONFIG: "../tsconfig.json" })).toThrow("dedicated .tsconfig-smoke-*.json");
  });
});
