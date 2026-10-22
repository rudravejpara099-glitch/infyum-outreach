import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { IgAccount } from "@/lib/db/types";
import { InstagramBlockedError, type InstagramDriver, type ProfileFacts, type WarmUpResult } from "./driver";
import { looksBlocked, looksLoggedOut } from "./parse";

type Page = { id: number; url: string };
type ToolTextResult = { isError?: boolean; content?: { type: string; text: string }[]; structuredContent?: { message?: string } };
export function jsonFromToolResult(result: ToolTextResult): unknown {
  const raw = [result.structuredContent?.message, ...(result.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [])].filter(Boolean).join("\n");
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? raw.match(/\{[^{}]*\}/)?.[0];
  if (!candidate) return null;
  try { return JSON.parse(candidate) as unknown; } catch { return null; }
}
export function chromeMcpArgs(bin: string): string[] {
  return [bin, "--auto-connect", "--channel=stable", "--allowed-url-pattern=https://www.instagram.com/*", "--allowed-url-pattern=https://instagram.com/*", "--no-usage-statistics", "--no-performance-crux", "--no-category-input", "--no-category-emulation", "--no-category-performance", "--no-category-network", "--no-category-memory", "--no-category-extensions", "--no-category-pwa"];
}
export function isAllowedInstagramUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.instagram.com" || url.hostname === "instagram.com");
  } catch { return false; }
}
export function bindInstagramPage(pages: Page[], handle: string): Page | null {
  const exactPath = `/${handle.replace(/^@/, "").toLowerCase()}/`;
  return pages.find((page) => isAllowedInstagramUrl(page.url) && new URL(page.url).pathname.toLowerCase() === exactPath) ?? null;
}
export function instagramProfileUrl(handle: string): string {
  const normalized = handle.replace(/^@/, "");
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(normalized) || normalized === "." || normalized === "..") throw new Error("Invalid Instagram handle.");
  return `https://www.instagram.com/${normalized}/`;
}

/** Read-only access to the owner's existing Chrome session. No write-capable MCP tool is called. */
export class ChromeReadOnlyInstagram implements InstagramDriver {
  private client?: Client;
  private transport?: StdioClientTransport;
  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const entry = createRequire(import.meta.url).resolve("chrome-devtools-mcp");
    const bin = join(dirname(entry), "bin", "chrome-devtools-mcp.js");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: chromeMcpArgs(bin),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CI: "1", CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1" },
      stderr: "ignore",
    });
    const client = new Client({ name: "infyum-instagram-read-only", version: "1.0.0" });
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
    return client;
  }
  private async pages(): Promise<Page[]> {
    const result = await (await this.connect()).callTool({ name: "list_pages", arguments: {} }) as ToolTextResult & { structuredContent?: { pages?: Page[]; message?: string } };
    if (result.isError) {
      const message = [result.structuredContent?.message, ...(result.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [])].filter(Boolean).join(" ");
      throw new Error(message || "Chrome could not list its open pages.");
    }
    if (result.structuredContent?.pages?.length) return result.structuredContent.pages.map((page) => ({ id: Number(page.id), url: page.url })).filter((page) => Number.isSafeInteger(page.id));
    const text = result.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
    return [...text.matchAll(/(?:^|\n)\s*(\d+):\s*(.*?)\s+\((https?:\/\/[^)]+)\)/g)].map((m) => ({ id: Number(m[1]), url: m[3].trim() }));
  }
  private async openProfile(account: IgAccount, handle = account.handle): Promise<{ pageId: number; url: string }> {
    const client = await this.connect();
    const url = instagramProfileUrl(handle);
    let page = bindInstagramPage(await this.pages(), handle);
    if (!page) {
      await client.callTool({ name: "new_page", arguments: { url, background: true } });
      page = bindInstagramPage(await this.pages(), handle);
    }
    if (!page) throw new Error("Could not open the Instagram profile in Chrome.");
    return { pageId: page.id, url: page.url };
  }
  private async inspect(account: IgAccount, handle = account.handle): Promise<{ pageId: number; text: string; controls: string; url: string }> {
    const page = await this.openProfile(account, handle);
    const result = await (await this.connect()).callTool({ name: "evaluate_script", arguments: {
      pageId: page.pageId, waitForStableDom: false,
      function: "() => ({ text: document.body?.innerText ?? '', controls: Array.from(document.querySelectorAll('button,[role=button]')).map(e => (e.getAttribute('aria-label') || e.innerText || '')).join(' ') })",
    } }) as ToolTextResult;
    const parsed = jsonFromToolResult(result) as { text?: unknown; controls?: unknown } | null;
    if (!parsed) throw new Error("Instagram did not return readable profile information.");
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const controls = typeof parsed.controls === "string" ? parsed.controls : "";
    if (!isAllowedInstagramUrl(page.url)) throw new Error("Chrome is not showing an allowed Instagram page.");
    if (looksBlocked(text, page.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review it in Chrome.");
    if (looksLoggedOut(page.url, text) || !/edit profile/i.test(`${text} ${controls}`)) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
    return { ...page, text, controls };
  }
  async openLogin(account: IgAccount): Promise<boolean> {
    const p = await this.openProfile(account);
    const result = await (await this.connect()).callTool({ name: "evaluate_script", arguments: {
      pageId: p.pageId, waitForStableDom: false,
      function: "() => ({ text: document.body?.innerText ?? '', loggedIn: /edit profile/i.test(document.body?.innerText ?? '') })",
    } }) as ToolTextResult;
    const value = jsonFromToolResult(result) as { text?: unknown; loggedIn?: unknown } | null;
    if (!value) return false;
    const text = typeof value.text === "string" ? value.text : "";
    if (looksBlocked(text, p.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review it in Chrome.");
    return value.loggedIn === true;
  }
  async readFacts(account: IgAccount, handle: string): Promise<ProfileFacts> {
    await this.inspect(account, handle);
    throw new Error("Campaign profile checks are not enabled for signed-in Chrome yet. The account sign-in check completed, and no campaign action was taken.");
  }
  async readProfileNotes(account: IgAccount, handle: string): Promise<string> { return (await this.inspect(account, handle)).text.slice(0, 4000); }
  async readInbox(): Promise<{ handle: string; text: string }[]> { throw new Error("Inbox reading is not enabled in Chrome read-only mode yet."); }
  async warmUp(): Promise<WarmUpResult> { throw new Error("Campaign actions are disabled in Chrome read-only mode."); }
  async sendMessages(): Promise<void> { throw new Error("Message sending is disabled in Chrome read-only mode."); }
  async close(): Promise<void> { await this.client?.close(); await this.transport?.close(); this.client = undefined; this.transport = undefined; }
}
