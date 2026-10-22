import { describe, expect, it } from "vitest";
import { posix, win32 } from "node:path";
import { browserModeAllowsJob, browserModeAllowsLeadSearch, loginCheckFailure } from "@/lib/domain/browser-mode";
import { bindInstagramPage, chromeEndpointFromActivePort, chromeMcpArgs, chromeUserDataDir, ensureChromeToolSucceeded, instagramLoginCheckScript, instagramProfileUrl, isAllowedInstagramUrl, isInstagramInboxUrl, jsonFromToolResult, loginStateFromToolResult } from "@/worker/chrome-read-only";
import { openDb } from "@/lib/db/core";
import { createAccount, setAccountBrowserMode } from "@/lib/db/repos/accounts";

describe("signed-in Chrome mode", () => {
  it("allows approved message sends but keeps warm-up and paid AI/search jobs disabled in Chrome mode", () => {
    for (const job of ["warmup", "draft_dm", "draft_followup", "find_leads"]) {
      expect(browserModeAllowsJob("chrome_read_only", job)).toBe(false);
    }
    expect(browserModeAllowsJob("chrome_read_only", "open_login")).toBe(true);
    expect(browserModeAllowsJob("chrome_read_only", "qualify")).toBe(true);
    expect(browserModeAllowsJob("chrome_read_only", "check_inbox")).toBe(true);
    expect(browserModeAllowsJob("chrome_read_only", "send")).toBe(true);
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
    expect(isInstagramInboxUrl("https://www.instagram.com/direct/inbox/")).toBe(true);
    expect(isInstagramInboxUrl("https://www.instagram.com/direct/t/123_Ab-/")).toBe(true);
    expect(isInstagramInboxUrl("https://www.instagram.com/direct/requests/")).toBe(false);
    expect(isInstagramInboxUrl("https://attacker.example/direct/inbox/")).toBe(false);
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
    let chromeAccessError = "";
    try { ensureChromeToolSucceeded({ isError: true, content: [{ type: "text", text: "EPERM: operation not permitted, open '/Users/private/Library/Application Support/Google/Chrome/DevToolsActivePort'" }] }, "fallback"); }
    catch (error) { chromeAccessError = error instanceof Error ? error.message : String(error); }
    expect(chromeAccessError).toContain("Reopen the signed-in Chrome profile");
    expect(chromeAccessError).not.toContain("/Users/private");
    expect(ensureChromeToolSucceeded({ content: [{ type: "text", text: "ok" }] }, "fallback")).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(loginStateFromToolResult({ content: [{ type: "text", text: "```json\n{\"allowed\":true,\"loggedIn\":false}\n```" }] })).toEqual({ text: "", loggedIn: false });
    expect(() => loginStateFromToolResult({ content: [{ type: "text", text: "no status returned" }] })).toThrow("no Instagram sign-in status");
    expect(() => loginStateFromToolResult({ content: [{ type: "text", text: "```json\n{\"allowed\":false,\"text\":\"private unrelated page\",\"loggedIn\":true}\n```" }] })).toThrow("expected Instagram profile");
  });

  it("reads page text only while Chrome still shows the exact saved Instagram profile", () => {
    const script = instagramLoginCheckScript("@owner");
    expect(script).toContain("location.protocol === 'https:'");
    expect(script).toContain("location.pathname.toLowerCase() === \"/owner/\"");
    expect(script.indexOf("if (!allowed) return")).toBeLessThan(script.indexOf("document.body?.innerText"));
    expect(() => instagramLoginCheckScript("https://attacker.example")).toThrow("Invalid Instagram handle");
  });

  it("uses Chrome's temporary WebSocket address when available and otherwise auto-connects to the selected profile", () => {
    const profilePath = "/test/chrome-profile";
    const activePort = "43821\n/devtools/browser/abc-123\n";
    expect(chromeEndpointFromActivePort(activePort)).toBe("ws://127.0.0.1:43821/devtools/browser/abc-123");
    expect(chromeEndpointFromActivePort("0\n/devtools/browser/abc\n")).toBeNull();
    expect(chromeEndpointFromActivePort("9222\n/../../private\n")).toBeNull();
    const args = chromeMcpArgs("chrome-devtools-mcp.js", profilePath, activePort);
    expect(args).toContain("--ws-endpoint=ws://127.0.0.1:43821/devtools/browser/abc-123");
    expect(args).not.toContain("--auto-connect");
    expect(args).not.toContain("--user-data-dir");
    expect(args).toContain("--allowed-url-pattern=https://www.instagram.com/*");
    expect(args).toContain("--allowed-url-pattern=https://instagram.com/*");
    expect(() => chromeMcpArgs("chrome-devtools-mcp.js", profilePath, "9222\n/invalid\n")).toThrow("local debugging address is invalid");
    const defaultArgs = chromeMcpArgs("chrome-devtools-mcp.js");
    expect(defaultArgs).toContain("--auto-connect");
    expect(defaultArgs).toContain("--channel=stable");
    expect(defaultArgs[defaultArgs.indexOf("--user-data-dir") + 1]).toBe(chromeUserDataDir());
    expect(chromeUserDataDir("darwin", "/Users/test")).toBe(posix.join("/Users/test", "Library", "Application Support", "Google", "Chrome"));
    expect(chromeUserDataDir("linux", "/home/test")).toBe(posix.join("/home/test", ".config", "google-chrome"));
    expect(chromeUserDataDir("win32", "C:\\Users\\test", "C:\\Users\\test\\AppData\\Local")).toBe(win32.join("C:\\Users\\test\\AppData\\Local", "Google", "Chrome", "User Data"));
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
