import { describe, expect, it, vi } from "vitest";
import type { IgAccount } from "@/lib/db/types";
import { ChromeReadOnlyInstagram } from "@/worker/chrome-read-only";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const owner: IgAccount = { id: 1, handle: "owner", label: "", profileDir: "/tmp/owner", browserMode: "chrome_read_only", dailyCap: 35, rampStart: "2026-01-01", status: "active", statusNote: "" };
const result = (message: string) => ({ structuredContent: { message } });

describe("signed-in Chrome DM driver", () => {
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
    const driver = new ChromeReadOnlyInstagram(fakeClient);

    await driver.sendMessages(owner, "prospect", ["A reviewed message from the user"]);

    expect(calls.filter((call) => ["click", "fill", "press_key"].includes(call.name))).toEqual([
      { name: "click", args: { pageId: 8, uid: "msg-button" } },
      { name: "fill", args: { pageId: 8, uid: "message-box", value: "A reviewed message from the user" } },
      { name: "press_key", args: { pageId: 8, key: "Enter" } },
    ]);
  });

  it("refuses empty messages before interacting with Chrome", async () => {
    const fakeClient = { callTool: vi.fn(), close: vi.fn() } as unknown as Client;
    const driver = new ChromeReadOnlyInstagram(fakeClient);
    await expect(driver.sendMessages(owner, "prospect", [" "])).rejects.toThrow("approved message is empty");
    expect(fakeClient.callTool).not.toHaveBeenCalled();
  });
});
