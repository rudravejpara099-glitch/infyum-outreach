import { describe, expect, it } from "vitest";
import { hostChromeAllowed, normalizeInviteEmail, normalizeWorkspaceName, workspaceFormMatches, workspaceWorkerEnv } from "@/lib/domain/workspace-rules";

describe("workspace rules", () => {
  it("normalizes a bounded company name and rejects blank, non-text or control characters", () => {
    expect(normalizeWorkspaceName("  Acme Studios  ")).toBe("Acme Studios");
    expect(normalizeWorkspaceName("x".repeat(100))).toHaveLength(100);
    for (const value of [null, {}, 5, " ", "x".repeat(101), "Acme\nCompany", "Acme\u0000"]) expect(normalizeWorkspaceName(value)).toBeNull();
  });
  it("normalizes invitation email while rejecting invalid values", () => {
    expect(normalizeInviteEmail("  PERSON@EXAMPLE.COM ")).toBe("person@example.com");
    for (const value of [null, {}, 5, "", "bad address", "a@@example.com", "a@example", "a\u0000@example.com", `${"a".repeat(250)}@example.com`]) expect(normalizeInviteEmail(value)).toBeNull();
  });
  it("rejects forms from another company, absent fields and non-text fields", () => {
    expect(workspaceFormMatches("legacy", "legacy")).toBe(true);
    for (const value of [undefined, null, {}, 1, "Legacy", "legacy ", "other"]) expect(workspaceFormMatches("legacy", value)).toBe(false);
  });
  it("confines the already signed-in host browser to the original workspace", () => {
    expect(hostChromeAllowed("legacy")).toBe(true);
    for (const value of ["", "Legacy", "legacy ", "../../legacy", "7f164cb9-7e3b-4e37-ab67-a5e417b5cd14"]) expect(hostChromeAllowed(value)).toBe(false);
  });
});


describe("workspace worker credentials", () => {
  const secrets = ["ANTHROPIC_API_KEY", "APIFY_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "BILLING_OWNER_USER_ID", "SESSION_SECRET"];
  it("copies the original team's environment without changing the parent", () => {
    const source: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: "/fixture/bin", ANTHROPIC_API_KEY: "fixture-owner", SESSION_SECRET: "fixture-session" };
    const result = workspaceWorkerEnv(source, true);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    result.ANTHROPIC_API_KEY = "changed-child";
    expect(source.ANTHROPIC_API_KEY).toBe("fixture-owner");
  });
  it("explicitly empties every owner credential for a private company", () => {
    const source = Object.fromEntries(secrets.map(key => [key, `fixture-${key}`]));
    const result = workspaceWorkerEnv({ ...source, PATH: "/fixture/bin", NODE_ENV: "production" }, false);
    for (const key of secrets) { expect(result).toHaveProperty(key, ""); expect(source[key]).toBe(`fixture-${key}`); }
    expect(result.PATH).toBe("/fixture/bin");
    expect(result.NODE_ENV).toBe("production");
  });
  it("keeps missing credentials explicitly empty so an env file cannot fill them", () => {
    const result = workspaceWorkerEnv({ NODE_ENV: "test" }, false);
    for (const key of secrets) expect(result).toHaveProperty(key, "");
  });
});
