import { dirname, join, win32 } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { IgAccount } from "@/lib/db/types";
import { InstagramBlockedError, InstagramSendUncertainError, type InstagramDriver, type ProfileFacts, type WarmUpResult } from "./driver";
import { looksBlocked, looksLoggedOut } from "./parse";
import { inboxIdentityUrl, inboxItemFromToolResult, inboxListScript, inboxOpenThreadScript, inboxThreadIndicesFromToolResult, inboxThreadPathFromToolResult, inboxThreadScript, profileFactsFromToolResult, profileFactsScript } from "./chrome-read-only-data";

type Page = { id: number; url: string };
type ToolTextResult = { isError?: boolean; content?: { type: string; text: string }[]; structuredContent?: { message?: string } };
const CHROME_REQUEST_TIMEOUT_MS = 30_000;
export function ensureChromeToolSucceeded<T extends ToolTextResult>(result: T, fallback: string): T {
  if (!result.isError) return result;
  const details = [result.structuredContent?.message, ...(result.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [])].filter(Boolean).join(" ");
  if (/403|remote debugging|DevToolsActivePort|could not connect to Chrome/i.test(details)) throw new Error("Chrome remote debugging permission was denied.");
  throw new Error(fallback);
}
export function loginStateFromToolResult(result: ToolTextResult): { text: string; loggedIn: boolean } {
  const parsed = jsonFromToolResult(ensureChromeToolSucceeded(result, "Chrome could not verify the Instagram sign-in state.")) as { allowed?: unknown; text?: unknown; loggedIn?: unknown } | null;
  if (!parsed || typeof parsed.loggedIn !== "boolean") throw new Error("Chrome returned no Instagram sign-in status.");
  if (parsed.allowed !== true) throw new Error("Chrome is no longer showing the expected Instagram profile.");
  return { text: typeof parsed.text === "string" ? parsed.text : "", loggedIn: parsed.loggedIn };
}
export function jsonFromToolResult(result: ToolTextResult): unknown {
  const raw = [result.structuredContent?.message, ...(result.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [])].filter(Boolean).join("\n");
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? raw.match(/\{[^{}]*\}/)?.[0];
  if (!candidate) return null;
  try { return JSON.parse(candidate) as unknown; } catch { return null; }
}
export function chromeUserDataDir(platform: NodeJS.Platform = process.platform, home = process.env.HOME || homedir(), localAppData = process.env.LOCALAPPDATA || home): string {
  const pathJoin = platform === "win32" ? win32.join : join;
  if (platform === "darwin") return pathJoin(home, "Library", "Application Support", "Google", "Chrome");
  if (platform === "win32") return pathJoin(localAppData, "Google", "Chrome", "User Data");
  return pathJoin(home, ".config", "google-chrome");
}
export function chromeMcpArgs(bin: string, userDataDir = chromeUserDataDir()): string[] {
  return [bin, "--auto-connect", "--channel=stable", "--user-data-dir", userDataDir, "--allowed-url-pattern=https://www.instagram.com/*", "--allowed-url-pattern=https://instagram.com/*", "--no-usage-statistics", "--no-performance-crux", "--no-category-emulation", "--no-category-performance", "--no-category-network", "--no-category-memory", "--no-category-extensions", "--no-category-pwa"];
}
export function isAllowedInstagramUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.instagram.com" || url.hostname === "instagram.com");
  } catch { return false; }
}
export function isInstagramInboxUrl(value: string): boolean {
  if (!isAllowedInstagramUrl(value)) return false;
  const path = new URL(value).pathname.replace(/\/$/, "");
  return path === "/direct/inbox" || /^\/direct\/t\/[A-Za-z0-9_-]+$/.test(path);
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
export function instagramLoginCheckScript(handle: string): string {
  const expectedPath = new URL(instagramProfileUrl(handle)).pathname.toLowerCase();
  return `() => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.toLowerCase() === ${JSON.stringify(expectedPath)};
    if (!allowed) return { allowed: false, loggedIn: false };
    const text = document.body?.innerText ?? '';
    return { allowed: true, text, loggedIn: /edit profile/i.test(text) };
  }`;
}

/** Access to the owner's explicitly selected Chrome session, restricted to Instagram pages. */
export class ChromeInstagram implements InstagramDriver {
  private client?: Client;
  private transport?: StdioClientTransport;
  constructor(testClient?: Client) { this.client = testClient; }
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
    const client = new Client({ name: "infyum-instagram-campaign", version: "1.0.0" });
    try {
      await client.connect(transport, { timeout: CHROME_REQUEST_TIMEOUT_MS });
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
    this.transport = transport;
    this.client = client;
    return client;
  }
  private async pages(): Promise<Page[]> {
    const result = ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "list_pages", arguments: {} }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult & { structuredContent?: { pages?: Page[]; message?: string } }, "Chrome could not list its open pages.");
    if (result.structuredContent?.pages?.length) return result.structuredContent.pages.map((page) => ({ id: Number(page.id), url: page.url })).filter((page) => Number.isSafeInteger(page.id));
    const text = result.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
    return [...text.matchAll(/(?:^|\n)\s*(\d+):\s*(.*?)\s+\((https?:\/\/[^)]+)\)/g)].map((m) => ({ id: Number(m[1]), url: m[3].trim() }));
  }
  private async openProfile(account: IgAccount, handle = account.handle): Promise<{ pageId: number; url: string }> {
    const client = await this.connect();
    const url = instagramProfileUrl(handle);
    let page = bindInstagramPage(await this.pages(), handle);
    if (!page) {
      ensureChromeToolSucceeded(await client.callTool({ name: "new_page", arguments: { url, background: true } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open the Instagram profile.");
      page = bindInstagramPage(await this.pages(), handle);
    }
    if (!page) throw new Error("Could not open the Instagram profile in Chrome.");
    return { pageId: page.id, url: page.url };
  }
  private async inboxPages(): Promise<Page[]> {
    const client = await this.connect();
    let pages = (await this.pages()).filter((item) => isInstagramInboxUrl(item.url));
    if (pages.length === 0) {
      ensureChromeToolSucceeded(await client.callTool({ name: "new_page", arguments: { url: inboxIdentityUrl(), background: true } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open Instagram replies.");
      pages = (await this.pages()).filter((item) => isInstagramInboxUrl(item.url));
    }
    if (pages.length === 0) throw new Error("Could not open Instagram replies in Chrome.");
    return pages.slice(0, 5);
  }
  private async evaluate(pageId: number, script: string, fallback: string): Promise<ToolTextResult> {
    return ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "evaluate_script", arguments: {
      pageId, waitForStableDom: false, function: script,
    } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, fallback);
  }
  private async snapshot(pageId: number): Promise<string> {
    const result = ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "take_snapshot", arguments: { pageId } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not inspect the Instagram page.");
    return [result.structuredContent?.message, ...(result.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [])].filter(Boolean).join("\n");
  }
  private async clickNamed(pageId: number, snapshot: string, role: string, name: string): Promise<void> {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const uid = snapshot.match(new RegExp(`uid=([^\\s]+)\\s+${role}\\s+"${escaped}"`, "i"))?.[1];
    if (!uid) throw new Error(`Instagram did not show the expected ${name} control.`);
    ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "click", arguments: { pageId, uid } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, `Chrome could not select ${name}.`);
  }
  private async sendPart(pageId: number, part: string, onSubmit: () => void): Promise<void> {
    const snapshot = await this.snapshot(pageId);
    const uid = snapshot.match(/uid=([^\s]+)\s+textbox\s+"[^"]*(?:message|write a message)[^"]*"/i)?.[1];
    if (!uid) throw new Error("Instagram did not show a message box.");
    ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "fill", arguments: { pageId, uid, value: part } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not enter the approved message.");
    onSubmit();
    ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "press_key", arguments: { pageId, key: "Enter" } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not submit the message.");
  }
  private async verifyOwner(account: IgAccount): Promise<void> {
    const page = await this.openProfile(account);
    const result = await this.evaluate(page.pageId, instagramLoginCheckScript(account.handle), "Chrome could not verify the saved Instagram account.");
    const state = loginStateFromToolResult(result);
    if (looksBlocked(state.text, page.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
    if (!state.loggedIn) throw new InstagramBlockedError("The saved Instagram account is not signed in in Chrome.");
  }
  private async inspect(account: IgAccount, handle = account.handle): Promise<{ pageId: number; text: string; controls: string; url: string }> {
    const page = await this.openProfile(account, handle);
    const result = ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "evaluate_script", arguments: {
      pageId: page.pageId, waitForStableDom: false,
      function: "() => ({ text: document.body?.innerText ?? '', controls: Array.from(document.querySelectorAll('button,[role=button]')).map(e => (e.getAttribute('aria-label') || e.innerText || '')).join(' ') })",
    } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not read the Instagram profile state.");
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
      function: instagramLoginCheckScript(account.handle),
    } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult;
    const { text, loggedIn } = loginStateFromToolResult(result);
    if (looksBlocked(text, p.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review it in Chrome.");
    return loggedIn;
  }
  async readFacts(account: IgAccount, handle: string): Promise<ProfileFacts> {
    await this.verifyOwner(account);
    const page = await this.openProfile(account, handle);
    const result = await this.evaluate(page.pageId, profileFactsScript(handle), "Chrome could not read Instagram profile facts.");
    if (looksBlocked("", page.url) || !isAllowedInstagramUrl(page.url)) throw new Error("Chrome is not showing an allowed Instagram profile.");
    return profileFactsFromToolResult(result);
  }
  async readProfileNotes(account: IgAccount, handle: string): Promise<string> {
    await this.verifyOwner(account);
    const page = await this.openProfile(account, handle);
    const result = await this.evaluate(page.pageId, "() => ({ text: document.querySelector('header')?.innerText ?? '', alts: Array.from(document.querySelectorAll('main img[alt]')).map(image => image.alt).filter(value => value.length > 20).slice(0, 8) })", "Chrome could not read Instagram profile notes.");
    const parsed = jsonFromToolResult(result) as { text?: unknown; alts?: unknown } | null;
    if (!parsed || typeof parsed.text !== "string" || !Array.isArray(parsed.alts)) throw new Error("Instagram profile notes were unavailable.");
    if (looksBlocked(parsed.text, page.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
    const alts = parsed.alts.filter((value): value is string => typeof value === "string");
    return [`Profile header:\n${parsed.text}`, alts.length ? `Recent posts (image descriptions):\n- ${alts.join("\n- ")}` : ""].filter(Boolean).join("\n\n");
  }
  async readInbox(account: IgAccount): Promise<{ handle: string; text: string }[]> {
    await this.verifyOwner(account);
    let identityError: Error | null = null;
    for (const page of await this.inboxPages()) {
      const result = await this.evaluate(page.id, inboxListScript(account.handle), "Chrome could not read Instagram replies.");
      let indices: number[];
      try { indices = inboxThreadIndicesFromToolResult(result); }
      catch (error) {
        if (error instanceof InstagramBlockedError) throw error;
        identityError = error instanceof Error ? error : new Error("Instagram replies could not be verified.");
        continue;
      }
      const items: { handle: string; text: string }[] = [];
      for (const [position, index] of indices.entries()) {
        const opened = await this.evaluate(page.id, inboxOpenThreadScript(account.handle, index), "Chrome could not open an Instagram reply.");
        const path = inboxThreadPathFromToolResult(opened);
        const thread = await this.evaluate(page.id, inboxThreadScript(account.handle, path), "Chrome could not read an Instagram reply.");
        const incoming = inboxItemFromToolResult(thread);
        if (incoming) items.push(incoming);
        if (position < indices.length - 1) {
          ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "navigate_page", arguments: {
            pageId: page.id, type: "back",
          } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not return to Instagram replies.");
        }
      }
      return items;
    }
    throw identityError ?? new Error("The saved Instagram account could not be confirmed before reading replies.");
  }
  async warmUp(): Promise<WarmUpResult> { throw new Error("Likes, comments, and follows are not enabled for signed-in Chrome campaigns."); }
  async sendMessages(account: IgAccount, handle: string, parts: string[]): Promise<void> {
    if (parts.length === 0 || parts.some((part) => !part.trim())) throw new Error("The approved message is empty.");
    await this.verifyOwner(account);
    const target = await this.openProfile(account, handle);
    let snapshot = await this.snapshot(target.pageId);
    await this.clickNamed(target.pageId, snapshot, "button", "Message");
    snapshot = await this.snapshot(target.pageId);
    if (!/textbox\s+"[^"]*(?:message|write a message)/i.test(snapshot)) throw new Error(`Chat with @${handle} did not open.`);
    let attempted = false;
    try {
      for (const part of parts) {
        await this.sendPart(target.pageId, part, () => { attempted = true; });
        const check = await this.evaluate(target.pageId, `() => ({ allowed: location.protocol === 'https:' && (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') && location.pathname.startsWith('/direct/'), text: document.body?.innerText ?? '' })`, "Chrome could not verify the sent message.");
        const parsed = jsonFromToolResult(check) as { allowed?: unknown; text?: unknown } | null;
        if (parsed?.allowed !== true || typeof parsed.text !== "string") throw new Error("Instagram chat identity could not be verified after sending.");
        if (looksBlocked(parsed.text, `https://www.instagram.com/direct/inbox/`)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
        if (!parsed.text.includes(part.slice(0, Math.min(30, part.length)))) throw new Error(`The message to @${handle} did not appear in the conversation.`);
      }
    } catch (error) {
      if (attempted) throw new InstagramSendUncertainError(error instanceof InstagramBlockedError);
      throw error;
    }
  }
  async close(): Promise<void> { await this.client?.close(); await this.transport?.close(); this.client = undefined; this.transport = undefined; }
}
