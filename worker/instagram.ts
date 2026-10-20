import { chromium, type BrowserContext, type Page } from "playwright";
import type { IgAccount } from "@/lib/db/types";
import { InstagramBlockedError, type InstagramDriver, type ProfileFacts, type WarmUpResult } from "./driver";
import { followersFromText, looksBlocked, looksLoggedOut, skipComment } from "./parse";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (min: number, max: number) => sleep(min + Math.random() * (max - min));

/** Real Instagram, driven through a visible browser window that keeps its own login per account. */
export class PlaywrightInstagram implements InstagramDriver {
  private contexts = new Map<number, BrowserContext>();

  private async context(account: IgAccount): Promise<BrowserContext> {
    const existing = this.contexts.get(account.id);
    if (existing) return existing;
    const ctx = await chromium.launchPersistentContext(account.profileDir, { headless: false, viewport: { width: 1280, height: 900 }, locale: "en-US" });
    ctx.on("close", () => this.contexts.delete(account.id));
    this.contexts.set(account.id, ctx);
    return ctx;
  }

  private async page(account: IgAccount): Promise<Page> {
    const ctx = await this.context(account);
    return ctx.pages()[0] ?? (await ctx.newPage());
  }

  /** Opens a URL and stops everything if Instagram wants a login or shows a warning. */
  private async go(account: IgAccount, url: string): Promise<Page> {
    const page = await this.page(account);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await between(1500, 3000);
    await this.guard(page);
    return page;
  }

  private async guard(page: Page): Promise<void> {
    if (looksLoggedOut(page.url())) throw new InstagramBlockedError("Not logged in. Use Open login window on the Accounts page.");
    const text = await page.locator("body").innerText().catch(() => "");
    if (looksBlocked(text, page.url())) throw new InstagramBlockedError("Instagram showed a warning or a human check. Review the account by hand.");
  }

  async openLogin(account: IgAccount): Promise<void> {
    const ctx = await this.context(account);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    // The team signs in, then closes the window. Give them up to 15 minutes.
    await Promise.race([new Promise<void>((r) => ctx.once("close", () => r())), sleep(15 * 60_000)]);
    await ctx.close().catch(() => {});
  }

  async readFacts(account: IgAccount, handle: string): Promise<ProfileFacts> {
    const page = await this.go(account, `https://www.instagram.com/${handle}/`);
    const body = await page.locator("body").innerText();
    if (/isn't available|page isn.t available/i.test(body)) throw new Error(`@${handle} does not exist`);
    const header = await page.locator("header").first().innerText();
    const followers = followersFromText(header) ?? (await page.locator('a[href$="/followers/"]').first().innerText().then(followersFromText).catch(() => null));
    if (followers == null) throw new Error(`Could not read follower count for @${handle}`);
    const isPublic = !/this account is private/i.test(body);
    const linkedToInfyum = /followed by[^\n]*infyum/i.test(header) || (await this.listHas(page, handle, "following", "infyum")) || (await this.listHas(page, handle, "followers", "infyum"));
    return { isPublic, country: await this.country(page), followers, linkedToInfyum };
  }

  /** Options menu, About this account, "Account based in". null when Instagram does not share it. */
  private async country(page: Page): Promise<string | null> {
    await page.locator('header [aria-label="Options"], header svg[aria-label="Options"]').first().click();
    await between(600, 1200);
    await page.getByText("About this account", { exact: true }).click();
    await between(1500, 2500);
    const dialog = (await page.locator('[role="dialog"]').last().innerText()).replace(/ /g, " ");
    await page.keyboard.press("Escape"); await between(300, 600); await page.keyboard.press("Escape");
    const m = dialog.match(/Account based in\s*\n?\s*([^\n]+)/i);
    const value = m?.[1].trim() ?? null;
    return !value || /not shared/i.test(value) ? null : value;
  }

  /** Searches a followers or following list for a word. Lists without a search box count as "not found". */
  private async listHas(page: Page, handle: string, which: "followers" | "following", needle: string): Promise<boolean> {
    await page.goto(`https://www.instagram.com/${handle}/${which}/`, { waitUntil: "domcontentloaded" });
    await between(1500, 2500);
    await this.guard(page);
    const search = page.locator('[role="dialog"] input[placeholder*="Search" i]').first();
    if (!(await search.count())) { await page.goto(`https://www.instagram.com/${handle}/`); return false; }
    await search.fill(needle);
    await between(1500, 2500);
    const found = /infyum/i.test(await page.locator('[role="dialog"]').last().innerText());
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
    return found;
  }

  async readProfileNotes(account: IgAccount, handle: string): Promise<string> {
    const page = await this.go(account, `https://www.instagram.com/${handle}/`);
    const header = (await page.locator("header").first().innerText()).replace(/\n{2,}/g, "\n");
    const alts = await page.locator('article img[alt], main img[alt]').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt).filter((a) => a.length > 20).slice(0, 8));
    return [`Profile header:\n${header}`, alts.length ? `Recent posts (image descriptions):\n- ${alts.join("\n- ")}` : ""].filter(Boolean).join("\n\n");
  }

  async warmUp(account: IgAccount, handle: string, pieces: number, makeComment: (context: string) => Promise<string>): Promise<WarmUpResult> {
    const page = await this.go(account, `https://www.instagram.com/${handle}/`);
    const links = await page.locator('a[href*="/p/"], a[href*="/reel/"]').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).href))]);
    const result: WarmUpResult = { likes: 0, comments: 0, followed: false };
    for (const url of links.slice(0, pieces)) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await between(2000, 4000);
      await this.guard(page);
      const caption = (await page.locator("main h1, article h1").first().innerText().catch(() => "")) || (await page.title());
      const like = page.locator('svg[aria-label="Like"]').first();
      if (await like.count()) { await like.click(); result.likes++; await between(1200, 2500); }
      if (!skipComment(caption)) {
        const box = page.locator('textarea[aria-label*="comment" i], textarea[placeholder*="comment" i]').first();
        if (await box.count()) {
          const text = await makeComment(`@${handle}: ${caption.slice(0, 400)}`);
          await box.click(); await page.keyboard.type(text, { delay: 60 + Math.random() * 60 });
          await between(800, 1500); await page.keyboard.press("Enter");
          await between(2000, 3500);
          if (await page.getByText(text.slice(0, 20)).count()) result.comments++;
          else throw new InstagramBlockedError("Comment did not post. Instagram may be limiting this account.");
        }
      }
      await between(3000, 8000);
    }
    // Follow is always last.
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
    await between(1500, 2500);
    const follow = page.getByRole("button", { name: "Follow", exact: true }).first();
    if (await follow.count()) { await follow.click(); await between(1500, 2500); }
    result.followed = (await page.getByRole("button", { name: /^(Following|Requested)$/ }).count()) > 0;
    return result;
  }

  async sendMessages(account: IgAccount, handle: string, parts: string[]): Promise<void> {
    const page = await this.go(account, `https://www.instagram.com/${handle}/`);
    const open = page.getByRole("button", { name: "Message", exact: true }).first();
    if (!(await open.count())) throw new Error(`@${handle} has no Message button`);
    await open.click();
    const box = page.locator('[role="textbox"][aria-label^="Message"], div[contenteditable="true"][aria-label^="Message"]').first();
    await box.waitFor({ timeout: 20_000 }).catch(() => { throw new Error(`Chat with @${handle} did not open`); });
    for (const part of parts) {
      await box.click();
      await page.keyboard.type(part, { delay: 25 + Math.random() * 35 });
      await sleep(1000);          // without this pause two messages can merge into one
      await page.keyboard.press("Enter");
      await between(1800, 3000);
      await this.guard(page);
      if (!(await page.getByText(part.slice(0, 30), { exact: false }).count())) throw new Error(`Message to @${handle} did not appear in the thread`);
    }
  }

  async readInbox(account: IgAccount): Promise<{ handle: string; text: string }[]> {
    const page = await this.go(account, "https://www.instagram.com/direct/inbox/");
    const rows = page.locator('a[href^="/direct/t/"]');
    const total = Math.min(await rows.count(), 15);
    const out: { handle: string; text: string }[] = [];
    for (let i = 0; i < total; i++) {
      const preview = (await rows.nth(i).innerText()).split("\n");
      if (preview.some((l) => /^You:/i.test(l))) continue;            // last message is ours
      await rows.nth(i).click(); await between(1500, 2500);
      const handle = (await page.locator('a[href^="/"][role="link"]').evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "").find((h) => /^\/[A-Za-z0-9._]+\/$/.test(h)) ?? "")).replace(/\//g, "");
      const text = (await page.locator('div[role="row"]').last().innerText().catch(() => "")).trim();
      if (handle && text) out.push({ handle: handle.toLowerCase(), text });
    }
    return out;
  }
}
