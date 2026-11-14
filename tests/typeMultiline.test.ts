import { expect, it, vi } from "vitest";
vi.mock("@/lib/domain/pacing", async (orig) => ({ ...(await orig<typeof import("@/lib/domain/pacing")>()), humanDelayMs: () => 0 }));
import { typeMultiline } from "@/worker/human";

it("uses Shift+Enter between paragraphs so one DM stays one message", async () => {
  const events: string[] = [];
  const page = { keyboard: { type: async (c: string) => { events.push(`type:${c}`); }, press: async (k: string) => { events.push(`press:${k}`); } } };
  await typeMultiline(page as never, "Hi\n\nYo");
  expect(events).toEqual(["type:H", "type:i", "press:Shift+Enter", "press:Shift+Enter", "type:Y", "type:o"]);
  expect(events).not.toContain("press:Enter");
});
