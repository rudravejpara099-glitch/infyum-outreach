import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { addLead, getLead, moveStage } from "@/lib/db/repos/leads";
import { isDnc, removeDnc } from "@/lib/db/repos/dnc";
import { listActivity } from "@/lib/db/repos/activity";
import { syncFromSheet } from "@/lib/sheets/from-sheet";
import { syncToSheet } from "@/lib/sheets/sync";
import { LEADS_HEADERS } from "@/lib/sheets/model";
import { FakeSheetGateway } from "./fake-sheet-gateway";

let db: Db; let sheet: FakeSheetGateway;
const STAGE = LEADS_HEADERS.indexOf("stage");
beforeEach(() => { db = openDb(":memory:"); sheet = new FakeSheetGateway(); });
afterEach(() => db.close());

const cell = (handle: string) => sheet.tabs.get("Leads")!.rows.find((r) => r[0] === handle)!;
const actions = () => listActivity(db, { limit: 500 }).map((a) => a.action);
async function leadAt(handle: string, ...path: ("qualified" | "warmed" | "dm_sent")[]) {
  const { lead } = addLead(db, { handle }, "t");
  for (const stage of path) moveStage(db, lead.id, stage, "t");
  await syncToSheet(db, sheet);
  return lead;
}

describe("Do-not-contact edits in the Sheet", () => {
  it("blocks a prospect added to the tab, closing or skipping its lead, and keeps unknown names blocked too", async () => {
    const lead = await leadAt("early.bird", "qualified");
    const sent = await leadAt("already.sent", "qualified", "warmed", "dm_sent");
    sheet.tabs.get("Do-not-contact")!.rows.push(["early.bird", "asked to stop", ""], ["@Already.Sent", "", ""], ["never.seen", "competitor", ""]);
    const result = await syncFromSheet(db, sheet);
    expect(result).toMatchObject({ ok: true, doNotContactAdded: 3 });
    for (const h of ["early.bird", "already.sent", "never.seen"]) expect(isDnc(db, h)).toBe(true);
    expect(getLead(db, lead.id)!.stage).toBe("skipped");
    expect(getLead(db, sent.id)!.stage).toBe("closed");
    expect(actions().filter((a) => a === "sheet.dnc_added")).toHaveLength(3);
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, doNotContactAdded: 0 });
  });
  it("does not unblock anyone when a name is removed from the tab", async () => {
    await leadAt("x");
    sheet.tabs.get("Do-not-contact")!.rows.push(["x", "", ""]);
    await syncFromSheet(db, sheet);
    sheet.tabs.get("Do-not-contact")!.rows.length = 0;
    await syncFromSheet(db, sheet);
    expect(isDnc(db, "x")).toBe(true);
    removeDnc(db, "x");
  });
});

describe("Stage edits in the Sheet", () => {
  it("moves the lead when a person changes the Stage cell along an allowed transition", async () => {
    const lead = await leadAt("anna");
    cell("anna")[STAGE] = "Qualified";
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 1, conflicts: 0 });
    expect(getLead(db, lead.id)!.stage).toBe("qualified");
    expect(actions()).toContain("lead.qualified");
  });
  it("refuses a move the app does not allow, logs it, and the next sync puts the cell back", async () => {
    const lead = await leadAt("bo");
    cell("bo")[STAGE] = "DM sent";
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 0 });
    expect(getLead(db, lead.id)!.stage).toBe("found");
    expect(actions()).toContain("sheet.stage_refused");
    await syncToSheet(db, sheet);
    expect(cell("bo")[STAGE]).toBe("Found");
  });
  it("does not undo an app change just because the Sheet still shows the old stage", async () => {
    const lead = await leadAt("cy");
    moveStage(db, lead.id, "qualified", "worker");
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 0, conflicts: 0 });
    expect(getLead(db, lead.id)!.stage).toBe("qualified");
    await syncToSheet(db, sheet);
    expect(cell("cy")[STAGE]).toBe("Qualified");
  });
  it("keeps a person's own labels on a handed-over lead and never overwrites them", async () => {
    const lead = await leadAt("dee", "qualified", "warmed", "dm_sent");
    cell("dee")[STAGE] = "Call booked";
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 0 });
    expect(getLead(db, lead.id)!.stage).toBe("dm_sent");
    await syncToSheet(db, sheet);
    await syncToSheet(db, sheet);
    expect(cell("dee")[STAGE]).toBe("Call booked");
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 0, conflicts: 0 });
  });
  it("turns Dead into Stopped for a lead that has been messaged", async () => {
    const lead = await leadAt("eve", "qualified", "warmed", "dm_sent");
    cell("eve")[STAGE] = "Dead";
    await syncFromSheet(db, sheet);
    expect(getLead(db, lead.id)!.stage).toBe("closed");
  });
  it("when both sides changed, the person's allowed edit wins and the conflict is logged", async () => {
    const lead = await leadAt("fay");
    moveStage(db, lead.id, "qualified", "worker");
    cell("fay")[STAGE] = "Dead";
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 1, conflicts: 1 });
    expect(getLead(db, lead.id)!.stage).toBe("skipped");
    expect(actions()).toContain("sheet.conflict");
  });
  it("ignores unknown stage text and names that are not leads", async () => {
    const lead = await leadAt("gus");
    cell("gus")[STAGE] = "Maybe later";
    sheet.tabs.get("Leads")!.rows.push(["someone.else", ...Array(LEADS_HEADERS.length - 1).fill("")]);
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 0 });
    expect(getLead(db, lead.id)!.stage).toBe("found");
  });
});

describe("the duplicate rule", () => {
  it("blocks a username that is in the Sheet's Leads tab but unknown to the app, once, and leaves the app's own leads alone", async () => {
    const own = await leadAt("mine");
    const row = ["handled.by.a.teammate", ...Array(LEADS_HEADERS.length - 1).fill("")];
    row[STAGE] = "DM sent";
    sheet.tabs.get("Leads")!.rows.push(row, ["'=BAD()", ...Array(LEADS_HEADERS.length - 1).fill("")]);
    const first = await syncFromSheet(db, sheet);
    expect(first).toMatchObject({ ok: true, knownNamesBlocked: 1 });
    expect(isDnc(db, "handled.by.a.teammate")).toBe(true);
    expect(isDnc(db, "mine")).toBe(false);
    expect(getLead(db, own.id)!.stage).toBe("found");
    expect(actions()).toContain("sheet.known_username");
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, knownNamesBlocked: 0 });
  });
});

describe("failure", () => {
  it("is recorded without throwing and the next call carries on", async () => {
    const lead = await leadAt("hal");
    cell("hal")[STAGE] = "Qualified";
    sheet.failOnce = "read:Do-not-contact";
    expect(await syncFromSheet(db, sheet)).toEqual({ ok: false, error: "Sheets API unavailable" });
    expect(getLead(db, lead.id)!.stage).toBe("found");
    expect(await syncFromSheet(db, sheet)).toMatchObject({ ok: true, stageChanges: 1 });
    expect(getLead(db, lead.id)!.stage).toBe("qualified");
  });
});
