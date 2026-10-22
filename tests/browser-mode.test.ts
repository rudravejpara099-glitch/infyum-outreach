import { describe, expect, it } from "vitest";
import { browserModeAllowsJob, browserModeAllowsLeadSearch } from "@/lib/domain/browser-mode";
import { bindInstagramPage, instagramProfileUrl, jsonFromToolResult } from "@/worker/chrome-read-only";
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

  it("binds only the exact Instagram handle tab and ignores other hosts", () => {
    const pages = [
      { id: 1, url: "https://www.instagram.com/other/" },
      { id: 2, url: "https://www.instagram.com/owner/" },
      { id: 3, url: "https://instagram.com/owner/" },
      { id: 4, url: "https://www.instagram.com/owner/messages/" },
      { id: 5, url: "https://attacker.example/owner/" },
    ];
    expect(bindInstagramPage(pages, "@owner")?.id).toBe(2);
    expect(bindInstagramPage(pages, "nobody")).toBeNull();
    expect(instagramProfileUrl("@owner")).toBe("https://www.instagram.com/owner/");
    expect(() => instagramProfileUrl("https://attacker.example")).toThrow("Invalid Instagram handle");
  });

  it("parses only the bridge's JSON result and tolerates either MCP result format", () => {
    expect(jsonFromToolResult({ content: [{ type: "text", text: "Script ran on page and returned:\n```json\n{\"loggedIn\":true}\n```" }] })).toEqual({ loggedIn: true });
    expect(jsonFromToolResult({ structuredContent: { message: "Script ran on page and returned:\n```json\n{\"loggedIn\":true}\n```" } })).toEqual({ loggedIn: true });
    expect(jsonFromToolResult({ content: [{ type: "text", text: "no readable result" }] })).toBeNull();
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
