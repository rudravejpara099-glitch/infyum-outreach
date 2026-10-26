import { expect, it, vi } from "vitest";
import { chromePages } from "@/lib/domain/chrome-pages";
import { ChromeInstagram, chromeMcpArgs, bindInstagramPage } from "@/worker/chrome-read-only";
import type { IgAccount } from "@/lib/db/types";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

it("accepts titled and URL-only tab records, preserving URL parentheses", () => {
  expect(chromePages({ content: [{ type: "text", text: "## Pages\n1: https://www.instagram.com/owner/ [selected]\n2: A title (https://www.instagram.com/p/a(b)/)\n3: https://instagram.com/direct/inbox/ isolatedContext=test\n4: title only\n" }] })).toEqual([{ id: 1, url: "https://www.instagram.com/owner/" }, { id: 2, url: "https://www.instagram.com/p/a(b)/" }, { id: 3, url: "https://instagram.com/direct/inbox/" }]);
});
it("treats structured pages as authoritative, validates IDs and ignores malformed entries", () => {
  const content = [{ type: "text", text: "7: https://www.instagram.com/wrong/" }];
  expect(chromePages({ structuredContent: { pages: [] }, content })).toEqual([]);
  expect(chromePages({ structuredContent: { pages: [{ id: 2, url: "https://instagram.com/owner/" }, { id: -1, url: "https://instagram.com/owner/" }, { id: "4", url: "https://instagram.com/owner/" }, null] }, content })).toEqual([{ id: 2, url: "https://instagram.com/owner/" }]);
});
it("still binds only the exact Instagram sender and ignores foreign hosts", () => {
  const pages = chromePages({ content: [{ type: "text", text: "1: https://instagram.com.attacker.example/owner/\n2: https://instagram.com/other/\n3: https://instagram.com/owner/" }] });
  expect(bindInstagramPage(pages, "owner")).toEqual({ id: 3, url: "https://instagram.com/owner/" });
  expect(chromeMcpArgs("bin")).toContain("--experimentalStructuredContent");
});
it("checks the existing sender from an untitled URL-only response without opening a duplicate tab", async () => {
  const callTool = vi.fn(async ({ name }: { name: string }) => name === "list_pages"
    ? { content: [{ type: "text", text: "## Pages\n7: https://www.instagram.com/owner/ [selected]" }] }
    : { content: [{ type: "text", text: 'Script returned:\n```json\n{"allowed":true,"loggedIn":true}\n```' }] });
  const driver = new ChromeInstagram({ callTool, close: vi.fn() } as unknown as Client);
  await expect(driver.openLogin({ id: 1, handle: "owner" } as IgAccount)).resolves.toBe(true);
  expect(callTool.mock.calls.map(([input]) => input.name)).toEqual(["list_pages", "evaluate_script"]);
});
