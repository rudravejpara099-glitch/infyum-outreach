import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IgAccount } from "@/lib/db/types";

const browserMocks = vi.hoisted(() => ({
  launchPersistentContext: vi.fn(),
  context: {
    pages: vi.fn(), newPage: vi.fn(), on: vi.fn(), once: vi.fn(), close: vi.fn(), cookies: vi.fn(),
  },
  page: { goto: vi.fn(), bringToFront: vi.fn(), url: vi.fn(), locator: vi.fn() },
}));

vi.mock("playwright", () => ({ chromium: { launchPersistentContext: browserMocks.launchPersistentContext } }));
vi.mock("@/worker/human", () => ({ wait: vi.fn().mockResolvedValue(undefined) }));

import { PlaywrightInstagram } from "@/worker/instagram";
import { AccountInstagramDriver } from "@/worker/instagram-driver";

describe("Instagram login browser launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.context.close.mockResolvedValue(undefined);
    browserMocks.context.pages.mockReturnValue([browserMocks.page]);
    browserMocks.context.once.mockImplementation((event: string, callback: () => void) => {
      if (event === "close") queueMicrotask(callback);
      return browserMocks.context;
    });
    browserMocks.launchPersistentContext.mockResolvedValue(browserMocks.context);
  });

  it("uses a dedicated headed Playwright Chromium profile, not the owner's Chrome session", async () => {
    const account = { id: 4, profileDir: "/profiles/instagram-4" } as IgAccount;
    const driver = new PlaywrightInstagram();

    expect(await driver.openLogin(account)).toBe(false);

    expect(browserMocks.launchPersistentContext).toHaveBeenCalledWith(account.profileDir, expect.objectContaining({
      headless: false, chromiumSandbox: true, locale: "en-US",
    }));
    const options = browserMocks.launchPersistentContext.mock.calls[0][1];
    expect(options).not.toHaveProperty("channel");
    expect(browserMocks.page.goto).toHaveBeenCalledWith("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    expect(browserMocks.page.bringToFront).toHaveBeenCalledOnce();
    expect(browserMocks.context.close).toHaveBeenCalledOnce();
  });

  it("stops profile reads when Instagram overlays a login prompt on a public profile", async () => {
    const account = { id: 4, profileDir: "/profiles/instagram-4" } as IgAccount;
    browserMocks.page.goto.mockResolvedValue(undefined);
    browserMocks.page.url.mockReturnValue("https://www.instagram.com/public.profile/");
    browserMocks.page.locator.mockReturnValue({ innerText: vi.fn().mockResolvedValue("Log in to see photos and videos from friends") });
    const driver = new PlaywrightInstagram();

    await expect(driver.readProfileNotes(account, "public.profile")).rejects.toThrow("Not logged in");
    expect(browserMocks.page.locator).toHaveBeenCalledWith("body");
  });

  it("closes persistent isolated browser contexts during driver shutdown", async () => {
    const account = { id: 4, profileDir: "/profiles/instagram-4", browserMode: "isolated" } as IgAccount;
    const secondAccount = { id: 5, profileDir: "/profiles/instagram-5", browserMode: "isolated" } as IgAccount;
    const secondContext = { ...browserMocks.context, close: vi.fn().mockRejectedValue(new Error("already closed")) };
    browserMocks.launchPersistentContext.mockResolvedValueOnce(browserMocks.context).mockResolvedValueOnce(secondContext);
    browserMocks.page.goto.mockResolvedValue(undefined);
    browserMocks.page.url.mockReturnValue("https://www.instagram.com/public.profile/");
    browserMocks.page.locator.mockImplementation((selector: string) => {
      if (selector === "body") return { innerText: vi.fn().mockResolvedValue("Public profile") };
      if (selector === "header") return { first: () => ({ innerText: vi.fn().mockResolvedValue("Public profile\n1,234 followers") }) };
      return { evaluateAll: vi.fn().mockResolvedValue([]) };
    });
    const driver = new AccountInstagramDriver();

    await driver.readProfileNotes(account, "public.profile");
    await driver.readProfileNotes(secondAccount, "public.profile");
    expect(browserMocks.context.close).not.toHaveBeenCalled();
    await driver.close();
    await driver.close();

    expect(browserMocks.context.close).toHaveBeenCalledOnce();
    expect(secondContext.close).toHaveBeenCalledOnce();
  });
});
