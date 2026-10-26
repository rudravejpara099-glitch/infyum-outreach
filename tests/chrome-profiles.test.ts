import { describe, expect, it, vi } from "vitest";
import type { IgAccount } from "@/lib/db/types";
import { ChromeInstagram } from "@/worker/chrome-read-only";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const owner: IgAccount = { id: 1, handle: "owner", label: "", profileDir: "/tmp/owner", browserMode: "chrome_read_only", dailyCap: 35, rampStart: "2026-01-01", status: "active", statusNote: "" };

describe("several Chrome profiles open at once", () => {
  it("works in the tab where the account is signed in, never in a new tab of another profile", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const callTool = vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push({ name, args });
      if (name === "list_pages") return { structuredContent: { pages: [
        { id: 7, url: "https://www.instagram.com/owner/" }, // another Chrome profile, signed out
        { id: 9, url: "https://www.instagram.com/owner/" }, // the signed-in profile
      ] } };
      if (name === "evaluate_script" && String(args.function).includes("edit profile")) {
        return { structuredContent: { message: JSON.stringify(args.pageId === 9 ? { allowed: true, loggedIn: true, text: "owner Edit profile posts followers" } : { allowed: true, loggedIn: false, text: "owner posts followers Follow Message" }) } };
      }
      if (name === "evaluate_script") return { structuredContent: { message: JSON.stringify({ allowed: true, ownerMatches: true, isInbox: true, listReady: true, indices: [] }) } };
      return { structuredContent: { message: "ok" } };
    });
    const driver = new ChromeInstagram({ callTool, close: vi.fn(async () => {}) } as unknown as Client);

    await expect(driver.readInbox(owner)).resolves.toEqual([]);

    expect(calls.some((call) => call.name === "new_page")).toBe(false);
    expect(calls.filter((call) => call.name === "navigate_page")).toEqual([
      { name: "navigate_page", args: { pageId: 9, type: "url", url: "https://www.instagram.com/direct/inbox/" } },
      { name: "navigate_page", args: { pageId: 9, type: "url", url: "https://www.instagram.com/owner/" } },
    ]);
  });
});
