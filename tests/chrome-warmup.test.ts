import { describe, expect, it, vi } from "vitest";
import { runChromeWarmup, type WarmupBrowser } from "@/worker/chrome-warmup";
import { instagramPostUrl, warmupPageScript, type WarmupPage } from "@/worker/chrome-warmup-data";
import { runInNewContext } from "node:vm";
import { InstagramBlockedError, InstagramWarmupUncertainError } from "@/worker/driver";
import { warmupCommentError } from "@/lib/domain/warmup-comment";
import { warmupComplete } from "@/lib/domain/warmup";
import { ChromeInstagram } from "@/worker/chrome-read-only";
import type { IgAccount } from "@/lib/db/types";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const profileUrl = "https://www.instagram.com/prospect/";
const posts = ["https://www.instagram.com/p/first/", "https://www.instagram.com/p/second/"];
const validComment = "Those details look amazing 🙌";
function fixture(captions = ["A detailed woodworking project", "A lesson on wood finishing"]) {
  let current = profileUrl, followed = false;
  const liked = new Set<string>(), comments = new Map<string, string>(), actions: string[] = [];
  const browser: WarmupBrowser = {
    navigate: vi.fn(async url => { current = url; actions.push(`open:${url}`); }),
    read: vi.fn(async (url, comment) => ({
      allowed: current === url, ownerMatches: true, text: "signed-in page", caption: captions[posts.indexOf(url)] ?? "",
      postUrls: url === profileUrl ? posts : [], liked: liked.has(url), following: followed,
      commentVisible: !!comment && comments.get(url) === comment,
    })),
    click: vi.fn(async name => { actions.push(name); if (name === "Like") liked.add(current); if (name === "Follow") followed = true; }),
    comment: vi.fn(async text => { actions.push(`comment:${text}`); comments.set(current, text); }),
    wait: vi.fn(async () => {}),
  };
  return { browser, actions, liked, comments };
}

describe("Chrome campaign preparation", () => {
  it("connects the real Chrome adapter to navigation, fresh controls, comment submission and receipt checks", async () => {
    let current = profileUrl, liked = false, followed = false, posted = false;
    const calls: string[] = [];
    const json = (value: unknown) => ({ structuredContent: { message: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` } });
    const callTool = vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push(name);
      if (name === "list_pages") return { structuredContent: { pages: [{ id: 7, url: "https://www.instagram.com/owner/" }, { id: 8, url: profileUrl }] } };
      if (name === "evaluate_script" && String(args.function).includes("edit profile")) return json({ allowed: true, loggedIn: true });
      if (name === "evaluate_script") return json({ allowed: true, ownerMatches: true, text: "signed in", caption: "Your handcrafted oak table", postUrls: posts, liked, following: followed, commentVisible: posted });
      if (name === "navigate_page") { current = String(args.url); return json({}); }
      if (name === "take_snapshot") return { content: [{ type: "text", text: current === profileUrl ? 'uid=follow button "Follow"' : 'uid=heart image "Like"\nuid=comment textbox "Add a comment…"' }] };
      if (name === "click" && args.uid === "heart") liked = true;
      if (name === "click" && args.uid === "follow") followed = true;
      if (name === "fill") expect(args.value).toBe(validComment);
      if (name === "press_key") posted = true;
      return json({});
    });
    const account: IgAccount = { id: 1, handle: "owner", label: "", profileDir: "/tmp/owner", browserMode: "chrome_read_only", dailyCap: 35, rampStart: "2026-01-01", status: "active", statusNote: "" };
    const driver = new ChromeInstagram({ callTool, close: vi.fn() } as unknown as Client, async () => {});
    await expect(driver.warmUp(account, "prospect", 1, async () => validComment)).resolves.toEqual({ likes: 1, comments: 1, followed: true });
    expect(calls.filter(name => ["click", "fill", "press_key"].includes(name))).toEqual(["click", "fill", "press_key", "click"]);
  });
  it("never comments twice on a post our account already commented on (an interrupted earlier warm-up)", async () => {
    const { browser, actions } = fixture();
    const read = browser.read;
    browser.read = vi.fn(async (url: string, comment?: string) => ({ ...(await read(url, comment)), ownerCommented: url === posts[0] }));
    const write = vi.fn(async () => validComment);
    await expect(runChromeWarmup(browser, profileUrl, 2, write)).resolves.toEqual({ likes: 2, comments: 1, followed: true });
    expect(write).toHaveBeenCalledTimes(1);
    expect(actions.filter((a) => a.startsWith("comment:"))).toHaveLength(1);
  });
  it("prepares the profile's posts, confirms each action, and follows last", async () => {
    const { browser, actions } = fixture();
    const write = vi.fn(async () => validComment);
    await expect(runChromeWarmup(browser, profileUrl, 2, write)).resolves.toEqual({ likes: 2, comments: 2, followed: true });
    expect(write).toHaveBeenCalledTimes(2);
    expect(actions).toEqual([
      `open:${posts[0]}`, "Like", `comment:${validComment}`,
      `open:${posts[1]}`, "Like", `comment:${validComment}`, `open:${profileUrl}`, "Follow",
    ]);
  });

  it("likes sensitive posts without generating or posting a comment", async () => {
    const { browser } = fixture(["Remembering a loved one at a funeral", "A church celebration"]);
    const write = vi.fn(async () => validComment);
    await expect(runChromeWarmup(browser, profileUrl, 2, write)).resolves.toEqual({ likes: 2, comments: 0, followed: true });
    expect(write).not.toHaveBeenCalled();
    expect(browser.comment).not.toHaveBeenCalled();
  });

  it("does not toggle an existing like off", async () => {
    const { browser, liked } = fixture();
    liked.add(posts[0]);
    await runChromeWarmup(browser, profileUrl, 1, async () => validComment);
    expect(browser.click).not.toHaveBeenCalledWith("Like");
  });

  it("refuses incomplete post lists and invalid comments before any social action", async () => {
    const { browser } = fixture();
    await expect(runChromeWarmup(browser, profileUrl, 10, async () => validComment)).rejects.toThrow("10 available posts");
    await expect(runChromeWarmup(browser, profileUrl, 1, async () => "Nice 🙌")).rejects.toThrow("3 to 8 words");
    expect(browser.click).not.toHaveBeenCalled();
    expect(browser.comment).not.toHaveBeenCalled();
  });

  it("rechecks campaign permission after generating a comment", async () => {
    const { browser } = fixture(); let running = true;
    await expect(runChromeWarmup(browser, profileUrl, 1, async () => { running = false; return validComment; }, () => running)).rejects.toThrow("stopped");
    expect(browser.click).not.toHaveBeenCalled();
    expect(browser.comment).not.toHaveBeenCalled();
  });

  it("holds a partial comment failure for review instead of replaying engagement", async () => {
    const { browser } = fixture();
    browser.comment = vi.fn(async () => { throw new Error("connection lost"); });
    await expect(runChromeWarmup(browser, profileUrl, 1, async () => validComment)).rejects.toBeInstanceOf(InstagramWarmupUncertainError);
    expect(browser.click).toHaveBeenCalledWith("Like");
    expect(browser.click).not.toHaveBeenCalledWith("Follow");
  });

  it("stops immediately on an Instagram warning and preserves the blocked-account signal", async () => {
    const { browser } = fixture();
    const read = browser.read;
    browser.read = vi.fn(async (url: string, comment?: string) => ({ ...await read(url, comment), text: "Action blocked" }));
    await expect(runChromeWarmup(browser, profileUrl, 1, async () => validComment)).rejects.toBeInstanceOf(InstagramBlockedError);
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("will not act under another account or after the page changes", async () => {
    const { browser } = fixture();
    const read = browser.read;
    browser.read = vi.fn(async (url: string, comment?: string): Promise<WarmupPage> => ({ ...await read(url, comment), ownerMatches: false }));
    await expect(runChromeWarmup(browser, profileUrl, 1, async () => validComment)).rejects.toThrow("no longer signed in");
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("validates page targets before building a read-only inspection script", () => {
    expect(() => warmupPageScript("https://other.example/p/first/", "owner")).toThrow("Invalid Instagram");
    const script = warmupPageScript(posts[0], "owner", validComment);
    expect(script).toContain("if (!allowed) return");
    expect(script.indexOf("if (!allowed) return")).toBeLessThan(script.indexOf("document.body"));
    expect(script).not.toContain(".click(");
  });

  it("supports the username-prefixed post links observed on the live Instagram grid", async () => {
    expect(instagramPostUrl("https://www.instagram.com/prospect/reel/AbC_123/?img_index=1")).toBe("https://www.instagram.com/p/AbC_123/");
    expect(instagramPostUrl("https://evil.example/prospect/p/AbC_123/")).toBeNull();
    const root = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => selector === 'a[href]' ? [
        { href: "https://www.instagram.com/prospect/p/AbC_123/" },
        { href: "https://www.instagram.com/p/AbC_123/?img_index=1" },
        { href: "https://evil.example/p/AbC_123/" },
      ] : [],
    };
    const state = await runInNewContext(`(${warmupPageScript(profileUrl, "owner")})()`, {
      URL, setTimeout, location: new URL(profileUrl),
      document: { body: { innerText: "profile" }, querySelector: () => root, querySelectorAll: (selector: string) => selector === "a[href]" ? [{ getAttribute: (name: string) => name === "href" ? "/owner/" : "Profile", querySelectorAll: () => [] }] : [] },
    });
    expect(state.postUrls).toEqual(["https://www.instagram.com/p/AbC_123/"]);
  });
});

describe("warm-up comment rules", () => {
  it("does not call an incomplete warm-up ready for a first message", () => {
    expect(warmupComplete({ likes: 10, comments: 0, followed: true }, 10)).toBe(true);
    for (const value of [{ likes: 9, comments: 9, followed: true }, { likes: 10, comments: 10, followed: false }, { likes: 10, comments: 11, followed: true }]) expect(warmupComplete(value, 10)).toBe(false);
  });
  it("accepts 3 to 8 words and 1 to 3 emoji graphemes", () => {
    expect(warmupCommentError(validComment)).toBeNull();
    expect(warmupCommentError("Your family looks wonderful 👨‍👩‍👦")).toBeNull();
  });
  it("rejects missing emoji, excessive words, links, hashtags and every dash form", () => {
    for (const text of ["Those details look amazing", "One two three four five six seven eight nine 🙌", "Those details look amazing 🙌🙌🙌🙌", "Those details look amazing #wood 🙌", "Those details look-amazing 🙌", "Those details look—amazing 🙌", "Those details https://site.test 🙌"]) {
      expect(warmupCommentError(text)).not.toBeNull();
    }
  });
});
