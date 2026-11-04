import { describe, expect, it, vi } from "vitest";
import { GoogleSheetsGateway } from "@/lib/sheets/google";
import { TABS } from "@/lib/sheets/model";

type Call = { url: string; method: string; body: unknown; auth: string | null };
function fakeFetch(answers: (call: Call) => unknown | { status: number }) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") };
    calls.push(call);
    const out = answers(call) as { status?: number };
    if (out && typeof out === "object" && "status" in out && out.status && out.status >= 400) return new Response("{}", { status: out.status });
    return new Response(JSON.stringify(out ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const gateway = (f: typeof fetch) => new GoogleSheetsGateway("sheet123", async () => "tok", f);

describe("GoogleSheetsGateway", () => {
  it("creates missing tabs, locks the header row, sets the Stage dropdown and writes headers", async () => {
    const { calls, fetcher } = fakeFetch((c) => {
      if (c.method === "GET") return { sheets: [{ properties: { sheetId: 1, title: "Leads" } }] };
      if (c.url.endsWith(":batchUpdate") && JSON.stringify(c.body ?? "").includes("addSheet")) return { replies: TABS.slice(1).map((t, i) => ({ addSheet: { properties: { sheetId: 10 + i, title: t.name } } })) };
      return {};
    });
    await gateway(fetcher).ensureWorkbook(TABS);
    expect(calls.every((c) => c.auth === "Bearer tok" && c.url.includes("/sheet123"))).toBe(true);
    const add = calls.find((c) => JSON.stringify(c.body ?? "").includes("addSheet"))!;
    expect((add.body as { requests: unknown[] }).requests).toHaveLength(4);
    const rules = JSON.stringify(calls.map((c) => c.body));
    expect(rules).toContain("addProtectedRange");
    expect(rules.match(/addProtectedRange/g)).toHaveLength(5);
    expect(rules).toContain("ONE_OF_LIST");
    expect(rules).toContain("Follow-up due");
    const headers = calls.find((c) => c.url.endsWith("/values:batchUpdate"))!.body as { data: { range: string; values: string[][] }[] };
    expect(headers.data[0]).toMatchObject({ range: "'Leads'!A1:T1", values: [TABS[0].headers] });
  });
  it("does not lock a header row that is already locked", async () => {
    const protectedAlready = TABS.map((t, i) => ({ properties: { sheetId: i, title: t.name }, protectedRanges: [{ range: { startRowIndex: 0 } }] }));
    const { calls, fetcher } = fakeFetch((c) => (c.method === "GET" ? { sheets: protectedAlready } : {}));
    await gateway(fetcher).ensureWorkbook(TABS);
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("addProtectedRange");
  });
  it("updates an existing row in place and appends only new ones", async () => {
    const { calls, fetcher } = fakeFetch((c) => (c.url.includes("/values/'Leads'!A2%3AA") ? { values: [["anna"], ["bo"]] } : {}));
    await gateway(fetcher).upsertRows("Leads", 0, [["bo", "x"], ["cy", "y"]]);
    const update = calls.find((c) => c.url.endsWith("/values:batchUpdate"))!.body as { data: { range: string }[] };
    expect(update.data).toEqual([{ range: "'Leads'!A3", values: [["bo", "x"]] }]);
    const append = calls.find((c) => c.url.includes(":append"))!;
    expect(append.body).toEqual({ values: [["cy", "y"]] });
  });
  it("reads rows under the header and turns an API error into a thrown error the sync can record", async () => {
    const ok = fakeFetch(() => ({ values: [["a", "b"]] }));
    expect(await gateway(ok.fetcher).readRows("Leads")).toEqual([["a", "b"]]);
    const bad = fakeFetch(() => ({ status: 429 }));
    await expect(gateway(bad.fetcher).readRows("Leads")).rejects.toThrow("Google Sheets answered 429");
  });
  it("sends nothing for empty writes", async () => {
    const { calls, fetcher } = fakeFetch(() => ({}));
    await gateway(fetcher).upsertRows("Leads", 0, []);
    await gateway(fetcher).appendRows("Activity Log", []);
    expect(calls).toHaveLength(0);
  });
});
