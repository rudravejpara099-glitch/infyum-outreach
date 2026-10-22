import { describe, expect, it } from "vitest";
import { browserModeAllowsJob, browserModeAllowsLeadSearch, loginCheckFailure } from "@/lib/domain/browser-mode";
import { bindInstagramPage, chromeMcpArgs, ensureChromeToolSucceeded, instagramProfileUrl, isAllowedInstagramUrl, jsonFromToolResult, loginStateFromToolResult } from "@/worker/chrome-read-only";
import { openDb } from "@/lib/db/core";
import { createAccount, setAccountBrowserMode } from "@/lib/db/repos/accounts";

describe("signed-in Chrome mode", () => {
  it("allows only the sign-in check, never campaign jobs", () => {
    for (const job of ["qualify", "warmup", "draft_dm", "draft_followup", "send", "check_inbox", "find_leads"]) {
      expect(browserModeAllowsJob("chrome_read_only", job)).toBe(false);
    }
    expect(browserModeAllowsJob("chrome_read_only", "open_login")).toBe(true);
    expect(browserModeAllowsJob("isolated", "send")).toBe(true);
    expect(browserModeAllowsLeadSearch(["chrome_read_only"])).toBe(false);
    expect(browserModeAllowsLeadSearch(["chrome_read_only", "isolated"])).toBe(true);
  });

  it("gives a safe next step for Chrome connection failures without showing local paths", () => {
    expect(loginCheckFailure("Could not connect to Chrome (403) at /Users/private/Chrome")).toContain("permission prompt");
    expect(loginCheckFailure("Instagram showed a human check")).toContain("Instagram needs you to review");
    expect(loginCheckFailure("unexpected page error")).toBe("The sign-in check could not finish. Try again from Accounts.");
  });

  it("binds only the exact Instagram handle tab and ignores other hosts", () => {
    const pages = [
      { id: 1, url: "https://www.instagram.com/other/" },
      { id: 2, url: "https://instagram.com/owner/" },
      { id: 3, url: "https://www.instagram.com/owner/" },
      { id: 4, url: "https://www.instagram.com/owner/messages/" },
      { id: 5, url: "https://attacker.example/owner/" },
      { id: 6, url: "https://instagram.com.attacker.example/owner/" },
    ];
    expect(bindInstagramPage(pages, "@owner")?.id).toBe(2);
    expect(bindInstagramPage(pages, "nobody")).toBeNull();
    expect(instagramProfileUrl("@owner")).toBe("https://www.instagram.com/owner/");
    expect(() => instagramProfileUrl("https://attacker.example")).toThrow("Invalid Instagram handle");
    expect(isAllowedInstagramUrl("https://www.instagram.com/owner/")).toBe(true);
    expect(isAllowedInstagramUrl("https://instagram.com/owner/")).toBe(true);
    expect(isAllowedInstagramUrl("https://m.instagram.com/owner/")).toBe(false);
    expect(isAllowedInstagramUrl("http://instagram.com/owner/")).toBe(false);
  });

  it("parses only the bridge's JSON result and tolerates either MCP result format", () => {
    expect(jsonFromToolResult({ content: [{ type: "text", text: "Script ran on page and returned:\n```json\n{\"loggedIn\":true}\n```" }] })).toEqual({ loggedIn: true });
    expect(jsonFromToolResult({ structuredContent: { message: "Script ran on page and returned:\n```json\n{\"loggedIn\":true}\n```" } })).toEqual({ loggedIn: true });
    expect(jsonFromToolResult({ content: [{ type: "text", text: "no readable result" }] })).toBeNull();
  });

  it("does not turn a Chrome bridge tool error into an unauthenticated result", () => {
    expect(() => ensureChromeToolSucceeded({ isError: true, content: [{ type: "text", text: "internal path and diagnostic" }] }, "Chrome could not verify sign-in."))
      .toThrow("Chrome could not verify sign-in.");
    expect(() => ensureChromeToolSucceeded({ isError: true, content: [{ type: "text", text: "403 at /Users/private/profile" }] }, "fallback"))
      .toThrow("Chrome remote debugging permission was denied.");
    expect(ensureChromeToolSucceeded({ content: [{ type: "text", text: "ok" }] }, "fallback")).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(loginStateFromToolResult({ content: [{ type: "text", text: "```json\n{\"loggedIn\":false}\n```" }] })).toEqual({ text: "", loggedIn: false });
    expect(() => loginStateFromToolResult({ content: [{ type: "text", text: "no status returned" }] })).toThrow("no Instagram sign-in status");
  });

  it("uses Chrome's approved auto-connect flow instead of a raw profile socket", () => {
    const args = chromeMcpArgs("chrome-devtools-mcp.js");
    expect(args).toContain("--auto-connect");
    expect(args).toContain("--channel=stable");
    expect(args).toContain("--allowed-url-pattern=https://www.instagram.com/*");
    expect(args).toContain("--allowed-url-pattern=https://instagram.com/*");
    expect(args.some((arg) => arg.startsWith("--user-data-dir="))).toBe(false);
  });

  it("keeps migrated accounts isolated until the owner opts into Chrome", () => {
    const db = openDb(":memory:");
    try {
      const account = createAccount(db, { handle: "existing", profileDir: "/tmp/existing" }, "test");
      expect(account.browserMode).toBe("isolated");
      setAccountBrowserMode(db, account.id, "chrome_read_only", "test");
      expect((db.prepare("SELECT browser_mode FROM ig_accounts WHERE id=?").get(account.id) as { browser_mode: string }).browser_mode).toBe("chrome_read_only");
      expect(() => db.prepare("UPDATE ig_accounts SET browser_mode='write-anything' WHERE id=?").run(account.id)).toThrow();
    } finally { db.close(); }
  });
});
