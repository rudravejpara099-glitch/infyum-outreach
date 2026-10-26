import { expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { IgAccount } from "@/lib/db/types";
import { ChromeInstagram } from "@/worker/chrome-read-only";
import { loginCheckFailure } from "@/lib/domain/browser-mode";

const owner = { id: 1, handle: "owner" } as IgAccount;
function fixture(states: { loggedIn: boolean; text: string }[]) {
  const callTool = vi.fn(async ({ name }: { name: string; arguments?: Record<string, unknown> }) => {
    if (name === "list_pages") return { structuredContent: { pages: [{ id: 7, url: "https://www.instagram.com/owner/" }] } };
    if (name === "evaluate_script") return { structuredContent: { message: JSON.stringify({ allowed: true, ...states.shift() }) } };
    return { content: [{ type: "text", text: "Refreshed" }] };
  });
  return { callTool, driver: new ChromeInstagram({ callTool, close: vi.fn() } as unknown as Client) };
}
it("recovers an empty profile splash with one cache-free reload of the same page", async () => {
  const { driver, callTool } = fixture([{ loggedIn: false, text: "" }, { loggedIn: true, text: "Edit Profile" }]);
  await expect(driver.openLogin(owner)).resolves.toBe(true);
  expect(callTool.mock.calls.filter(([r]) => r.name === "navigate_page").map(([r]) => r.arguments)).toEqual([{ pageId: 7, type: "reload", ignoreCache: true }]);
  expect(callTool.mock.calls.some(([r]) => r.name === "new_page")).toBe(false);
});
it("holds a still-empty page after one reload without treating it as signed out or reading inbox", async () => {
  const { driver, callTool } = fixture([{ loggedIn: false, text: "" }, { loggedIn: false, text: "  " }]);
  await expect(driver.openLogin(owner)).rejects.toThrow("Instagram is still loading");
  expect(callTool.mock.calls.map(([r]) => r.name)).toEqual(["list_pages", "evaluate_script", "navigate_page", "evaluate_script"]);
  expect(loginCheckFailure("Instagram is still loading in Chrome. /private/path")).toBe("Instagram is still loading in Chrome. Wait for its profile page to finish loading, then retry the check.");
});
it.each([false, true])("stops at a warning without any further recovery: afterReload=%s", async afterReload => {
  const warning = { loggedIn: false, text: "Confirm you're human" };
  const { driver, callTool } = fixture(afterReload ? [{ loggedIn: false, text: "" }, warning] : [warning]);
  await expect(driver.openLogin(owner)).rejects.toThrow("warning or human check");
  expect(callTool.mock.calls.filter(([r]) => r.name === "navigate_page")).toHaveLength(afterReload ? 1 : 0);
});
