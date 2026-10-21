import { describe, expect, it } from "vitest";
import { claudeLoginState, parseClaudeLoginState } from "@/lib/ui/claude-status";

describe("Claude sign-in status", () => {
  it("recognizes signed-in and signed-out CLI responses", () => {
    expect(parseClaudeLoginState('{"loggedIn":true}')).toBe("signed_in");
    expect(parseClaudeLoginState('{"loggedIn":false}')).toBe("signed_out");
  });

  it("does not mistake malformed or incomplete CLI output for a connection", () => {
    expect(parseClaudeLoginState("not json")).toBe("unknown");
    expect(parseClaudeLoginState('{"authMethod":"firstParty"}')).toBe("unknown");
    expect(parseClaudeLoginState('{"loggedIn":"yes"}')).toBe("unknown");
  });

  it("reports an unavailable CLI without exposing process errors", async () => {
    const missing = Object.assign(new Error("private executable path"), { code: "ENOENT" });
    await expect(claudeLoginState(async () => { throw missing; })).resolves.toBe("unavailable");
    await expect(claudeLoginState(async () => { throw new Error("private details"); })).resolves.toBe("unknown");
  });
});
