import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { addLead, moveStage } from "@/lib/db/repos/leads";
import { addDnc } from "@/lib/db/repos/dnc";
import { logActivity } from "@/lib/db/repos/activity";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { createOutgoing, markSent } from "@/lib/db/repos/messages";
import { SHEET_SYNC_EVERY_MS, sheetKnowsUsername, syncIfDue, syncToSheet } from "@/lib/sheets/sync";
import { SHEET_STAGES, STAGE_TO_SHEET, TABS, safeCell } from "@/lib/sheets/model";
import { STAGES } from "@/lib/domain/stages";
import { FakeSheetGateway } from "./fake-sheet-gateway";

let db: Db; let sheet: FakeSheetGateway;
beforeEach(() => { db = openDb(":memory:"); sheet = new FakeSheetGateway(); });
afterEach(() => db.close());

function seedLead(handle = "coach.anna") {
  const { lead } = addLead(db, { handle, niche: "coaching", followers: 12000 }, "t");
  moveStage(db, lead.id, "qualified", "t"); moveStage(db, lead.id, "warmed", "t");
  logActivity(db, "worker", "warmup.comment", { leadId: lead.id, detail: "That pricing story hit home" });
  logActivity(db, "worker", "lead.warmed_up", { leadId: lead.id });
  const m = createOutgoing(db, { leadId: lead.id, accountId: null, kind: "dm", parts: ["first line", "second line"], campaign: { approvalRequired: false } }, "t");
  markSent(db, m.id, new Date("2026-11-03T10:00:00Z")); moveStage(db, lead.id, "dm_sent", "t");
  return lead;
}

describe("Sheet layout", () => {
  it("has the document's five tabs, a Stage dropdown with nine stages, and a stage name for every app stage", () => {
    expect(TABS.map((t) => t.name)).toEqual(["Leads", "Settings", "Jobs", "Activity Log", "Do-not-contact"]);
    const leads = TABS[0];
    expect(leads.headers[leads.dropdown!.column]).toBe("stage");
    expect(leads.dropdown!.values).toHaveLength(9);
    expect(leads.dropdown!.values).toEqual([...SHEET_STAGES]);
    for (const stage of STAGES) expect(SHEET_STAGES).toContain(STAGE_TO_SHEET[stage]);
  });
  it("keeps text that looks like a formula as text", () => {
    expect(safeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeCell("+1")).toBe("'+1");
    expect(safeCell("plain")).toBe("plain");
    expect(safeCell(5)).toBe(5);
  });
});

describe("one-way sync", () => {
  it("creates the tabs once and mirrors a lead's whole history", async () => {
    const lead = seedLead();
    const result = await syncToSheet(db, sheet);
    expect(result).toMatchObject({ ok: true, leads: 1 });
    expect([...sheet.tabs.keys()]).toEqual(TABS.map((t) => t.name));
    const row = sheet.tabs.get("Leads")!.rows[0];
    const h = TABS[0].headers;
    expect(row[h.indexOf("username")]).toBe("coach.anna");
    expect(row[h.indexOf("stage")]).toBe("DM sent");
    expect(row[h.indexOf("dm_text")]).toBe("first line\n\nsecond line");
    expect(row[h.indexOf("comment_text")]).toBe("That pricing story hit home");
    expect(row[h.indexOf("followers")]).toBe("12000");
    expect(sheet.tabs.get("Activity Log")!.rows.length).toBeGreaterThanOrEqual(2);
    expect(sheet.calls.filter((c) => c === "ensure")).toHaveLength(1);
    expect(lead.id).toBeGreaterThan(0);
  });
  it("is idempotent: a second sync changes nothing and adds no duplicate rows", async () => {
    seedLead(); addDnc(db, "@Blocked.One", "asked to stop");
    await syncToSheet(db, sheet);
    const snapshot = JSON.stringify([...sheet.tabs.entries()].map(([k, v]) => [k, v.rows]));
    await syncToSheet(db, sheet);
    await syncToSheet(db, sheet);
    expect(JSON.stringify([...sheet.tabs.entries()].map(([k, v]) => [k, v.rows]))).toBe(snapshot);
    expect(sheet.calls.filter((c) => c === "ensure")).toHaveLength(1);
    expect(sheet.tabs.get("Do-not-contact")!.rows).toEqual([["blocked.one", "asked to stop", expect.any(String)]]);
  });
  it("updates a lead in place when its stage changes", async () => {
    const lead = seedLead();
    await syncToSheet(db, sheet);
    moveStage(db, lead.id, "replied", "t");
    await syncToSheet(db, sheet);
    const rows = sheet.tabs.get("Leads")!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0][TABS[0].headers.indexOf("stage")]).toBe("Replied");
  });
  it("sends only new activity rows each time", async () => {
    seedLead();
    await syncToSheet(db, sheet);
    const before = sheet.tabs.get("Activity Log")!.rows.length;
    logActivity(db, "worker", "inbox.checked", { detail: "one more" });
    const result = await syncToSheet(db, sheet);
    expect(result).toMatchObject({ ok: true, activityAdded: 1 });
    expect(sheet.tabs.get("Activity Log")!.rows).toHaveLength(before + 1);
  });
  it("shows only safe settings, never keys or tokens", async () => {
    setSetting(db, "anthropic_api_key", "sk-ant-secret"); setSetting(db, "apify_token", "apify_secret"); setSetting(db, "portfolio_link", "https://portfolio.infyum.com");
    await syncToSheet(db, sheet);
    const text = JSON.stringify([...sheet.tabs.values()].map((t) => t.rows));
    expect(text).not.toContain("sk-ant-secret"); expect(text).not.toContain("apify_secret");
    expect(sheet.tabs.get("Settings")!.rows).toEqual([["portfolio_link", "https://portfolio.infyum.com"]]);
  });
  it("never throws on a failure, records it, and catches up on the next call without losing activity", async () => {
    seedLead();
    sheet.failNext = 1;
    expect(await syncToSheet(db, sheet)).toEqual({ ok: false, error: "Sheets API unavailable" });
    expect(getSetting(db, "sheet_sync_error")).toBe("Sheets API unavailable");
    expect((await syncToSheet(db, sheet)).ok).toBe(true);
    expect(getSetting(db, "sheet_sync_error")).toBe("");
    expect(sheet.tabs.get("Leads")!.rows).toHaveLength(1);
    expect(sheet.tabs.get("Activity Log")!.rows.length).toBeGreaterThanOrEqual(2);
  });
  it("a failure halfway through keeps the activity marker back, so nothing is lost or doubled on retry", async () => {
    seedLead();
    sheet.failOnce = "append:Activity Log";
    expect(await syncToSheet(db, sheet)).toMatchObject({ ok: false });
    expect(getSetting(db, "sheet_activity_synced_id")).toBeNull();
    expect(sheet.tabs.get("Activity Log")!.rows).toHaveLength(0);
    expect((await syncToSheet(db, sheet)).ok).toBe(true);
    const ids = sheet.tabs.get("Activity Log")!.rows.map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });
  it("runs at most once a minute, also after a failed try", async () => {
    seedLead();
    const t0 = new Date("2026-11-03T10:00:00Z");
    expect(await syncIfDue(db, sheet, t0)).toMatchObject({ ok: true });
    expect(await syncIfDue(db, sheet, new Date(t0.getTime() + 30_000))).toBeNull();
    expect(await syncIfDue(db, sheet, new Date(t0.getTime() + SHEET_SYNC_EVERY_MS))).toMatchObject({ ok: true });
    sheet.failNext = 1;
    const t1 = new Date(t0.getTime() + 2 * SHEET_SYNC_EVERY_MS);
    expect(await syncIfDue(db, sheet, t1)).toMatchObject({ ok: false });
    expect(await syncIfDue(db, sheet, new Date(t1.getTime() + 10_000))).toBeNull();
  });
});

describe("duplicate rule against the Sheet", () => {
  it("finds a username already in Leads, or on the do-not-contact tab, ignoring @ and case", async () => {
    seedLead("Coach.Anna"); addDnc(db, "stopped.person");
    await syncToSheet(db, sheet);
    expect(await sheetKnowsUsername(sheet, "@coach.anna")).toEqual({ lead: true, doNotContact: false });
    expect(await sheetKnowsUsername(sheet, "STOPPED.person")).toEqual({ lead: false, doNotContact: true });
    expect(await sheetKnowsUsername(sheet, "someone.new")).toEqual({ lead: false, doNotContact: false });
  });
});
