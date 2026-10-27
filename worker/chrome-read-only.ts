import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { IgAccount } from "@/lib/db/types";
import { AlreadyContactedError, InstagramBlockedError, InstagramSendUncertainError, type InstagramDriver, type ProfileFacts, type WarmUpResult } from "./driver";
import { looksBlocked, looksLoggedOut } from "./parse";
import { runChromeWarmup } from "./chrome-warmup";
import { storyLikeScript, warmupPageScript, type WarmupPage } from "./chrome-warmup-data";

const handleOf = (profileUrl: string) => new URL(profileUrl).pathname.split("/").filter(Boolean)[0] ?? "";
import { chromePages, chromeProfileNeedsReload } from "@/lib/domain/chrome-pages";
import { chromeConnectionFailure } from "@/lib/domain/chrome-connection-failure";
import { humanDelayMs, type DelayKind } from "@/lib/domain/pacing";
import { INBOX_LOADING_ERROR, inboxIdentityUrl, inboxItemFromToolResult, inboxListScript, inboxOpenThreadScript, inboxThreadIndicesFromToolResult, inboxThreadIsLoadingFromToolResult, inboxThreadPathFromToolResult, inboxThreadScript, profileFactsFromToolResult, profileFactsScript } from "./chrome-read-only-data";

type Page = { id: number; url: string };
type ToolTextResult = { isError?: boolean; content?: { type: string; text: string }[]; structuredContent?: { message?: string } };
const CHROME_REQUEST_TIMEOUT_MS = 60_000;
const CHROME_PERMISSION_TIMEOUT_MS = 180_000;
export function ensureChromeToolSucceeded<T extends ToolTextResult>(result: T, fallback: string): T {
  if (!result.isError) return result;
  const details = [result.structuredContent?.message, ...(result.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [])].filter(Boolean).join(" ");
  const connectionFailure = chromeConnectionFailure(details);
  if (connectionFailure) throw new Error(connectionFailure);
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
/** Instagram pages plus the CDNs Instagram itself loads styles, scripts and images from. */
export const INSTAGRAM_CONTENT_PATTERNS = [
  "https://www.instagram.com/*", "https://instagram.com/*", "https://*.instagram.com/*",
  "https://*.cdninstagram.com/*", "https://*.fbcdn.net/*", "https://*.facebook.com/*", "https://*.facebook.net/*",
];
export function chromeMcpArgs(bin: string): string[] {
  // The allow-list also applies to subresources: Instagram's own styles, scripts and images come from its CDNs,
  // and blocking them leaves pages on the splash or unstyled. Navigation is still limited to instagram.com by
  // isAllowedInstagramUrl and the page checks.
  return [bin, "--auto-connect", "--channel=stable", "--experimentalStructuredContent",
    ...INSTAGRAM_CONTENT_PATTERNS.map((pattern) => `--allowed-url-pattern=${pattern}`), "--no-usage-statistics", "--no-performance-crux", "--no-category-emulation", "--no-category-performance", "--no-category-network", "--no-category-memory", "--no-category-extensions", "--no-category-pwa"];
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
  return `async () => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.toLowerCase() === ${JSON.stringify(expectedPath)};
    if (!allowed) return { allowed: false, loggedIn: false };
    // Instagram shows a blank splash before the profile renders; wait for the answer instead of reading the splash.
    const decided = () => /edit profile|log in|sign up/i.test(document.body?.innerText ?? '');
    const until = Date.now() + 15000;
    while (!decided() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 300));
    const text = document.body?.innerText ?? '';
    return { allowed: true, text, loggedIn: /edit profile/i.test(text) };
  }`;
}

/** Access to the owner's explicitly selected Chrome session, restricted to Instagram pages. */
export class ChromeInstagram implements InstagramDriver {
  private client?: Client;
  private transport?: StdioClientTransport;
  private browserConnected = false;
  constructor(testClient?: Client, private readonly pause: (kind: DelayKind) => Promise<void> = async kind => {
    await new Promise(resolve => setTimeout(resolve, humanDelayMs(kind, Math.random)));
  }) { this.client = testClient; }
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
    let response: ToolTextResult & { structuredContent?: { pages?: Page[]; message?: string } };
    try {
      response = await (await this.connect()).callTool({ name: "list_pages", arguments: {} }, undefined, { timeout: this.browserConnected ? CHROME_REQUEST_TIMEOUT_MS : CHROME_PERMISSION_TIMEOUT_MS }) as typeof response;
    } catch (error) {
      if (error instanceof Error && /MCP error -32001|request timed out/i.test(error.message)) {
        throw new Error("Chrome did not finish connecting. Check the signed-in Chrome window for an “Allow remote debugging?” prompt, approve it, then retry.");
      }
      throw error;
    }
    const result = ensureChromeToolSucceeded(response, "Chrome could not list its open pages.");
    this.browserConnected = true;
    this.lastPages = chromePages(result);
    return this.lastPages;
  }
  private async openProfile(account: IgAccount, handle = account.handle): Promise<{ pageId: number; url: string }> {
    const client = await this.connect();
    const url = instagramProfileUrl(handle);
    const pages = await this.pages();
    let page = bindInstagramPage(pages, handle);
    // A new tab opens in whichever Chrome profile window was used last, which may not be the signed-in one.
    // Reuse the tab already showing the signed-in account's own profile and visit the lead from there.
    const isLead = handle.replace(/^@/, "").toLowerCase() !== account.handle.toLowerCase();
    const verified = this.signedInPageId !== undefined ? pages.find((item) => item.id === this.signedInPageId) ?? null : null;
    if (isLead && verified) page = null; // Never use a lead tab that may belong to another Chrome profile.
    const ownerTab = !page && isLead ? verified ?? bindInstagramPage(pages, account.handle) : null;
    if (ownerTab) {
      ensureChromeToolSucceeded(await client.callTool({ name: "navigate_page", arguments: { pageId: ownerTab.id, type: "url", url } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open the Instagram profile.");
      return { pageId: ownerTab.id, url };
    }
    const owned = !page && this.ownedPageId !== undefined ? pages.find((item) => item.id === this.ownedPageId) ?? null : null;
    if (owned) {
      ensureChromeToolSucceeded(await client.callTool({ name: "navigate_page", arguments: { pageId: owned.id, type: "url", url } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open the Instagram profile.");
      return { pageId: owned.id, url };
    }
    if (!page) {
      // Open in front: Chrome throttles hidden tabs and Instagram barely renders them.
      ensureChromeToolSucceeded(await client.callTool({ name: "new_page", arguments: { url, background: false } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open the Instagram profile.");
      page = bindInstagramPage(await this.pages(), handle);
      if (page) this.ownedPageId = page.id;
    }
    if (!page) throw new Error("Could not open the Instagram profile in Chrome.");
    return { pageId: page.id, url: page.url };
  }
  private async inboxPages(): Promise<Page[]> {
    const client = await this.connect();
    const all = await this.pages();
    let pages = all.filter((item) => isInstagramInboxUrl(item.url));
    // Prefer the tab already confirmed as signed in: an old inbox tab can be stuck on Instagram's splash,
    // and a new tab could land in another Chrome profile's window.
    if (this.signedInPageId !== undefined && all.some((item) => item.id === this.signedInPageId)) {
      ensureChromeToolSucceeded(await client.callTool({ name: "navigate_page", arguments: { pageId: this.signedInPageId, type: "url", url: inboxIdentityUrl() } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open Instagram replies.");
      this.inboxBorrowed = true;
      return [{ id: this.signedInPageId, url: inboxIdentityUrl() } as Page];
    }
    if (pages.length === 0) {
      ensureChromeToolSucceeded(await client.callTool({ name: "new_page", arguments: { url: inboxIdentityUrl(), background: false } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not open Instagram replies.");
      pages = (await this.pages()).filter((item) => isInstagramInboxUrl(item.url));
    }
    if (pages.length === 0) throw new Error("Could not open Instagram replies in Chrome.");
    return pages.slice(0, 5);
  }
  private async inboxIndices(pageId: number, handle: string): Promise<number[]> {
    const script = inboxListScript(handle);
    const read = () => this.evaluate(pageId, script, "Chrome could not read Instagram replies.");
    try {
      return inboxThreadIndicesFromToolResult(await read());
    } catch (error) {
      // A read can fail while Instagram is still swapping the page; one calm retry, never more.
      if (error instanceof Error && error.message === "Chrome could not read Instagram replies.") {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return inboxThreadIndicesFromToolResult(await read());
      }
      if (!(error instanceof Error) || error.message !== INBOX_LOADING_ERROR) throw error;
      ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "navigate_page", arguments: { pageId, type: "reload" } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not refresh the loading Instagram inbox.");
      return inboxThreadIndicesFromToolResult(await read());
    }
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
  private async sendPart(pageId: number, part: string, onSubmit: () => void, mayContinue: () => boolean): Promise<void> {
    const snapshot = await this.snapshot(pageId);
    const uid = snapshot.match(/uid=([^\s]+)\s+textbox\s+"[^"]*(?:message|write a message)[^"]*"/i)?.[1];
    if (!uid) throw new Error("Instagram did not show a message box.");
    if (!mayContinue()) throw new Error("Message sending was stopped.");
    ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "fill", arguments: { pageId, uid, value: part } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not enter the approved message.");
    await this.pause("beforeSend");
    onSubmit();
    ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "press_key", arguments: { pageId, key: "Enter" } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not submit the message.");
  }
  private async verifyOwner(account: IgAccount): Promise<void> {
    if (!await this.openLogin(account)) throw new InstagramBlockedError("The saved Instagram account is not signed in in Chrome.");
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
  /**
   * The tab where this account is confirmed signed in. Several Chrome profiles can be open at once and a
   * new tab lands in whichever window was used last, so all Instagram work happens in this tab.
   */
  private signedInPageId?: number;
  private lastPages: Page[] = [];
  /** Tabs this app opened itself; reused for the next lead so Chrome never fills up with Instagram tabs. */
  private ownedPageId?: number;
  /** The signed-in tab was moved to the inbox and must go back to the profile afterwards. */
  private inboxBorrowed = false;
  async openLogin(account: IgAccount): Promise<boolean> {
    this.signedInPageId = undefined;
    const p = await this.openProfile(account);
    const read = async () => {
      const result = await (await this.connect()).callTool({ name: "evaluate_script", arguments: {
        pageId: p.pageId, waitForStableDom: false,
        function: instagramLoginCheckScript(account.handle),
      } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult;
      const state = loginStateFromToolResult(result);
      if (looksBlocked(state.text, p.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review it in Chrome.");
      return state;
    };
    let state = await read();
    if (chromeProfileNeedsReload(state)) {
      ensureChromeToolSucceeded(await (await this.connect()).callTool({ name: "navigate_page", arguments: { pageId: p.pageId, type: "reload", ignoreCache: true } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, "Chrome could not refresh the loading Instagram profile.");
      state = await read();
      if (chromeProfileNeedsReload(state)) throw new Error("Instagram is still loading in Chrome. Wait for its profile page to finish loading, then retry the check.");
    }
    if (state.loggedIn) { this.signedInPageId = p.pageId; return true; }
    // Another Chrome profile's window can also show this profile while signed out; try the other such tabs.
    const ownerPath = new URL(instagramProfileUrl(account.handle)).pathname.toLowerCase();
    for (const other of this.lastPages.filter((item) => item.id !== p.pageId && isAllowedInstagramUrl(item.url) && new URL(item.url).pathname.toLowerCase() === ownerPath)) {
      try {
        const result = await (await this.connect()).callTool({ name: "evaluate_script", arguments: {
          pageId: other.id, waitForStableDom: false, function: instagramLoginCheckScript(account.handle),
        } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult;
        const otherState = loginStateFromToolResult(result);
        if (looksBlocked(otherState.text, other.url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review it in Chrome.");
        if (otherState.loggedIn) { this.signedInPageId = other.id; return true; }
      } catch (error) {
        if (error instanceof InstagramBlockedError) throw error;
      }
    }

    // Instagram may omit its owner-only profile control while the signed-in
    // inbox still clearly identifies the same account.
    let identityError: Error | null = null;
    for (const page of await this.inboxPages()) {
      try {
        await this.inboxIndices(page.id, account.handle);
        return true;
      } catch (error) {
        if (error instanceof InstagramBlockedError) throw error;
        identityError = error instanceof Error ? error : new Error("Instagram sign-in could not be verified.");
      }
    }
    if (identityError) throw identityError;
    return false;
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
    try { return await this.readInboxOn(account); }
    finally {
      if (this.inboxBorrowed && this.signedInPageId !== undefined) await this.returnToOwner(account, this.signedInPageId);
      this.inboxBorrowed = false;
    }
  }
  private async readInboxOn(account: IgAccount): Promise<{ handle: string; text: string }[]> {
    let identityError: Error | null = null;
    for (const page of await this.inboxPages()) {
      let indices: number[];
      try { indices = await this.inboxIndices(page.id, account.handle); }
      catch (error) {
        if (error instanceof InstagramBlockedError) throw error;
        identityError = error instanceof Error ? error : new Error("Instagram replies could not be verified.");
        continue;
      }
      const items: { handle: string; text: string }[] = [];
      for (const [position, index] of indices.entries()) {
        const opened = await this.evaluate(page.id, inboxOpenThreadScript(account.handle, index), "Chrome could not open an Instagram reply.");
        if (inboxThreadIsLoadingFromToolResult(opened)) continue;
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
  /** Leave the shared tab on the signed-in account's profile so the next check finds it there. */
  private async returnToOwner(account: IgAccount, pageId: number): Promise<void> {
    try {
      await (await this.connect()).callTool({ name: "navigate_page", arguments: { pageId, type: "url", url: instagramProfileUrl(account.handle) } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS });
    } catch { /* The next run opens or finds the profile again. */ }
  }
  async warmUp(account: IgAccount, handle: string, pieces: number, makeComment: (context: string) => Promise<string>, mayContinue = () => true): Promise<WarmUpResult> {
    await this.verifyOwner(account);
    const target = await this.openProfile(account, handle);
    try { return await this.warmUpOn(account, target, pieces, makeComment, mayContinue); }
    finally { await this.returnToOwner(account, target.pageId); }
  }
  private async warmUpOn(account: IgAccount, target: { pageId: number; url: string }, pieces: number, makeComment: (context: string) => Promise<string>, mayContinue: () => boolean): Promise<WarmUpResult> {
    const call = async (name: string, args: Record<string, unknown>, error: string) =>
      ensureChromeToolSucceeded(await (await this.connect()).callTool({ name, arguments: { pageId: target.pageId, ...args } }, undefined, { timeout: CHROME_REQUEST_TIMEOUT_MS }) as ToolTextResult, error);
    return runChromeWarmup({
      navigate: async (url) => { await call("navigate_page", { type: "url", url }, "Chrome could not open the Instagram post."); },
      reload: async () => { await call("navigate_page", { type: "reload", ignoreCache: true }, "Chrome could not reload the Instagram page."); },
      read: async (url, comment) => {
        const parsed = jsonFromToolResult(await this.evaluate(target.pageId, warmupPageScript(url, account.handle, comment), "Chrome could not inspect warm-up progress."));
        if (!parsed || typeof parsed !== "object") throw new Error("Instagram returned no warm-up progress.");
        return parsed as WarmupPage;
      },
      likeStory: async () => {
        const parsed = jsonFromToolResult(await this.evaluate(target.pageId, storyLikeScript(handleOf(target.url)), "Chrome could not check the profile story."));
        const story = parsed && typeof parsed === "object" ? parsed as { hadStory?: unknown; liked?: unknown } : {};
        return { hadStory: story.hadStory === true, liked: story.liked === true };
      },
      click: async (name) => {
        const snapshot = await this.snapshot(target.pageId);
        await this.clickNamed(target.pageId, snapshot, name === "Like" && /image\s+"Like"/.test(snapshot) ? "image" : "button", name);
      },
      comment: async (text) => {
        const snapshot = await this.snapshot(target.pageId);
        const uid = snapshot.match(/uid=([^\s]+)\s+textbox\s+"[^"]*(?:add a comment|write a comment)[^"]*"/i)?.[1];
        if (!uid) throw new Error("Instagram did not show a comment box.");
        await call("fill", { uid, value: text }, "Chrome could not enter the prepared comment.");
        await this.pause("beforeSend");
        if (!mayContinue()) throw new Error("Campaign preparation was stopped.");
        await call("press_key", { key: "Enter" }, "Chrome could not post the prepared comment.");
      },
      wait: kind => this.pause(kind),
    }, target.url, pieces, makeComment, mayContinue);
  }
  async sendMessages(account: IgAccount, handle: string, parts: string[], mayContinue = () => true): Promise<void> {
    const check = () => { if (!mayContinue()) throw new Error("Message sending was stopped."); };
    check();
    if (parts.length === 0 || parts.some((part) => !part.trim())) throw new Error("The approved message is empty.");
    await this.verifyOwner(account);
    check();
    const target = await this.openProfile(account, handle);
    try { await this.sendOn(handle, parts, mayContinue, check, target); }
    finally { await this.returnToOwner(account, target.pageId); }
  }
  private async sendOn(handle: string, parts: string[], mayContinue: () => boolean, check: () => void, target: { pageId: number; url: string }): Promise<void> {
    check();
    // The profile can still be on Instagram's splash; wait for its Message button (up to ~15s).
    const hasMessageButton = (text: string) => /uid=[^\s]+\s+button\s+"Message"/i.test(text);
    let snapshot = await this.snapshot(target.pageId);
    for (let look = 0; !hasMessageButton(snapshot) && look < 10; look++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      snapshot = await this.snapshot(target.pageId);
    }
    await this.clickNamed(target.pageId, snapshot, "button", "Message");
    // The chat opens a moment after the click; look for its message box for up to about 15 seconds.
    const chatOpen = (text: string) => /textbox\s+"[^"]*(?:message|write a message)/i.test(text);
    snapshot = await this.snapshot(target.pageId);
    for (let look = 0; !chatOpen(snapshot) && look < 10; look++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      snapshot = await this.snapshot(target.pageId);
    }
    if (!chatOpen(snapshot)) throw new Error(`Chat with @${handle} did not open.`);
    // A first message must only go into a conversation we have never written in. Our earlier outreach
    // always carries our name or portfolio link, so look for it in the open conversation before typing.
    const history = jsonFromToolResult(await this.evaluate(target.pageId, `() => {
      const box = document.querySelector('[contenteditable="true"][role="textbox"], textarea[placeholder*="essage" i]');
      let area = box;
      for (let level = 0; area && level < 16 && (area.innerText || '').length < 300; level++) area = area.parentElement;
      const text = (area?.innerText || '');
      return { found: Boolean(box), ours: /infyum|portfolio\\.infyum\\.com/i.test(text) };
    }`, "Chrome could not read the Instagram conversation.")) as { found?: unknown; ours?: unknown } | null;
    if (history?.ours === true) throw new AlreadyContactedError(handle);
    let attempted = false;
    try {
      for (const [index, part] of parts.entries()) {
        check();
        await this.sendPart(target.pageId, part, () => { check(); attempted = true; }, mayContinue);
        // Instagram opens chats either on /direct/ pages or as a pop-up over the profile; accept both,
        // and give the sent text a few seconds to appear before deciding.
        const expected = JSON.stringify(part.slice(0, Math.min(30, part.length)));
        const receipt = await this.evaluate(target.pageId, `async () => {
          const onInstagram = location.protocol === 'https:' && (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com');
          const chatOpen = () => location.pathname.startsWith('/direct/') || Boolean(document.querySelector('[contenteditable="true"][role="textbox"]'));
          const until = Date.now() + 8000;
          while (onInstagram && chatOpen() && !(document.body?.innerText ?? '').includes(${expected}) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 400));
          return { allowed: onInstagram && chatOpen(), text: document.body?.innerText ?? '' };
        }`, "Chrome could not verify the sent message.");
        const parsed = jsonFromToolResult(receipt) as { allowed?: unknown; text?: unknown } | null;
        if (parsed?.allowed !== true || typeof parsed.text !== "string") throw new Error("Instagram chat identity could not be verified after sending.");
        if (looksBlocked(parsed.text, `https://www.instagram.com/direct/inbox/`)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
        if (!parsed.text.includes(part.slice(0, Math.min(30, part.length)))) throw new Error(`The message to @${handle} did not appear in the conversation.`);
        if (index < parts.length - 1) await this.pause("betweenParts");
      }
    } catch (error) {
      if (attempted) throw new InstagramSendUncertainError(error instanceof InstagramBlockedError);
      throw error;
    }
  }
  async close(): Promise<void> { await this.client?.close(); await this.transport?.close(); this.client = undefined; this.transport = undefined; this.browserConnected = false; }
}
