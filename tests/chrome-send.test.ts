import { describe, expect, it, vi } from "vitest";
import type { IgAccount } from "@/lib/db/types";
import { ChromeInstagram } from "@/worker/chrome-read-only";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const owner: IgAccount = { id: 1, handle: "owner", label: "", profileDir: "/tmp/owner", browserMode: "chrome_read_only", dailyCap: 35, rampStart: "2026-01-01", status: "active", statusNote: "" };
const result = (message: string) => ({ structuredContent: { message } });

describe("signed-in Chrome DM driver", () => {
  it("confirms the saved account from the inbox owner marker when the profile control is absent", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const fakeClient = {
      callTool: vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
        calls.push({ name, args });
        if (name === "list_pages") return { structuredContent: { pages: [
          { id: 7, url: "https://www.instagram.com/owner/" },
          { id: 8, url: "https://www.instagram.com/direct/inbox/" },
        ] } };
        if (name === "evaluate_script" && String(args.function).includes("edit profile")) {
          return result("```json\n{\"allowed\":true,\"loggedIn\":false}\n```");
        }
        return result("```json\n{\"allowed\":true,\"ownerMatches\":true,\"isInbox\":true,\"listReady\":true,\"indices\":[]}\n```");
      }),
      close: vi.fn(async () => {}),
    } as unknown as Client;

    await expect(new ChromeInstagram(fakeClient).openLogin(owner)).resolves.toBe(true);

    expect(calls.filter((call) => call.name === "evaluate_script")).toHaveLength(2);
    expect(String(calls[1].args.function)).toContain('"/owner/"');
  });

  it("does not accept a different inbox account as the saved account", async () => {
    const fakeClient = {
      callTool: vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
        if (name === "list_pages") return { structuredContent: { pages: [
          { id: 7, url: "https://www.instagram.com/owner/" },
          { id: 8, url: "https://www.instagram.com/direct/inbox/" },
        ] } };
        if (name === "evaluate_script" && String(args.function).includes("edit profile")) {
          return result("```json\n{\"allowed\":true,\"loggedIn\":false}\n```");
        }
        return result("```json\n{\"allowed\":true,\"ownerMatches\":false,\"isInbox\":true,\"listReady\":true,\"indices\":[]}\n```");
      }),
      close: vi.fn(async () => {}),
    } as unknown as Client;

    await expect(new ChromeInstagram(fakeClient).openLogin(owner)).rejects.toThrow("saved Instagram account could not be confirmed");
  });

  it("allows the read-only Chrome sign-in check enough time for a slow browser response", async () => {
    const callTool = vi.fn(async ({ name }: { name: string; arguments: Record<string, unknown> }, _extra?: unknown, options?: { timeout?: number }) => {
      void _extra;
      void options;
      if (name === "list_pages") return { structuredContent: { pages: [{ id: 7, url: "https://www.instagram.com/owner/" }] } };
      return { structuredContent: { message: JSON.stringify({ allowed: true, loggedIn: true, text: "Edit profile" }) } };
    });
    const fakeClient = { callTool, close: vi.fn(async () => {}) } as unknown as Client;
    const driver = new ChromeInstagram(fakeClient);

    await expect(driver.openLogin(owner)).resolves.toBe(true);

    expect(callTool.mock.calls.map(([, , options]) => options?.timeout)).toEqual([60_000, 60_000]);
  });

  it("turns a pending Chrome approval timeout into a clear next step", async () => {
    const fakeClient = {
      callTool: vi.fn(async () => { throw new Error("MCP error -32001: Request timed out"); }),
      close: vi.fn(async () => {}),
    } as unknown as Client;
    const driver = new ChromeInstagram(fakeClient);

    await expect(driver.openLogin(owner)).rejects.toThrow("Allow remote debugging?");
  });

  it("reloads the exact inbox once when its signed-in page is still loading", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let inboxReads = 0;
    const callTool = vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push({ name, args });
      if (name === "list_pages") return { structuredContent: { pages: [
        { id: 7, url: "https://www.instagram.com/owner/" },
        { id: 8, url: "https://www.instagram.com/direct/inbox/" },
      ] } };
      if (name === "evaluate_script") {
        if (String(args.function).includes("edit profile")) return { structuredContent: { message: JSON.stringify({ allowed: true, loggedIn: true }) } };
        inboxReads++;
        return { structuredContent: { message: JSON.stringify(inboxReads === 1
          ? { allowed: true, ownerMatches: false, isInbox: true, loading: true, indices: [] }
          : { allowed: true, ownerMatches: true, isInbox: true, listReady: true, indices: [] }) } };
      }
      return { structuredContent: { message: "ok" } };
    });
    const driver = new ChromeInstagram({ callTool, close: vi.fn(async () => {}) } as unknown as Client);

    await expect(driver.readInbox(owner)).resolves.toEqual([]);

    expect(calls.filter(call => call.name === "navigate_page")).toEqual([
      { name: "navigate_page", args: { pageId: 8, type: "reload" } },
    ]);
    expect(inboxReads).toBe(2);
  });

  it("does not reload an inbox when the saved account marker does not match", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const callTool = vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push({ name, args });
      if (name === "list_pages") return { structuredContent: { pages: [
        { id: 7, url: "https://www.instagram.com/owner/" },
        { id: 8, url: "https://www.instagram.com/direct/inbox/" },
      ] } };
      if (String(args.function).includes("edit profile")) return { structuredContent: { message: JSON.stringify({ allowed: true, loggedIn: true }) } };
      return { structuredContent: { message: JSON.stringify({ allowed: true, ownerMatches: false, isInbox: true, loading: false, indices: [] }) } };
    });
    const driver = new ChromeInstagram({ callTool, close: vi.fn(async () => {}) } as unknown as Client);

    await expect(driver.readInbox(owner)).rejects.toThrow("saved Instagram account");
    expect(calls.some(call => call.name === "navigate_page")).toBe(false);
  });

  it("uses the verified owner page, fresh controls, and the approved message text", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const fakeClient = {
      callTool: vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
        calls.push({ name, args });
        if (name === "list_pages") return { structuredContent: { pages: calls.some((call) => call.name === "new_page")
          ? [{ id: 7, url: "https://www.instagram.com/owner/" }, { id: 8, url: "https://www.instagram.com/prospect/" }]
          : [{ id: 7, url: "https://www.instagram.com/owner/" }] } };
        if (name === "evaluate_script" && String(args.function).includes("edit profile")) return result("```json\n{\"allowed\":true,\"loggedIn\":true}\n```");
        if (name === "take_snapshot" && !calls.some((call) => call.name === "click")) return { content: [{ type: "text", text: "uid=msg-button button \"Message\"" }] };
        if (name === "take_snapshot") return { content: [{ type: "text", text: "uid=message-box textbox \"Message...\"" }] };
        if (name === "evaluate_script") return result("```json\n{\"allowed\":true,\"text\":\"A reviewed message from the user\"}\n```");
        return { content: [{ type: "text", text: "ok" }] };
      }),
      close: vi.fn(async () => {}),
    } as unknown as Client;
    const driver = new ChromeInstagram(fakeClient);

    await driver.sendMessages(owner, "prospect", ["A reviewed message from the user"]);

    expect(calls.filter((call) => ["click", "fill", "press_key"].includes(call.name))).toEqual([
      { name: "click", args: { pageId: 8, uid: "msg-button" } },
      { name: "fill", args: { pageId: 8, uid: "message-box", value: "A reviewed message from the user" } },
      { name: "press_key", args: { pageId: 8, key: "Enter" } },
    ]);
  });

  it("refuses empty messages before interacting with Chrome", async () => {
    const fakeClient = { callTool: vi.fn(), close: vi.fn() } as unknown as Client;
    const driver = new ChromeInstagram(fakeClient);
    await expect(driver.sendMessages(owner, "prospect", [" "])).rejects.toThrow("approved message is empty");
    expect(fakeClient.callTool).not.toHaveBeenCalled();
  });
});
