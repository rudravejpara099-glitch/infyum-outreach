import { describe, expect, it } from "vitest";
import { loginWindowCommand } from "@/lib/services/login-window-command";

describe("login window command", () => {
  it("starts the account-scoped login-only process without forwarding credentials", () => {
    expect(loginWindowCommand(7, 12, "/app")).toEqual({
      command: process.execPath,
      args: ["--import", "tsx", "/app/scripts/open-instagram-login.ts", "7", "12"],
    });
  });

  it.each([[0, 1], [-1, 1], [1.5, 1], [1, 0], [1, 1.5], [Number.MAX_SAFE_INTEGER + 1, 1], [1, Number.NaN]])("rejects invalid IDs (%s)", (accountId, jobId) => {
    expect(() => loginWindowCommand(accountId as number, jobId as number, "/app")).toThrow("A valid account and sign-in request are required");
  });
});
