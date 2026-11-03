import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { addLead, getLead } from "@/lib/db/repos/leads";
import { isDnc } from "@/lib/db/repos/dnc";
import { runSheetCycle } from "@/lib/sheets/cycle";
import { LEADS_HEADERS } from "@/lib/sheets/model";
import { FakeSheetGateway } from "./fake-sheet-gateway";

let db: Db; let sheet: FakeSheetGateway;
beforeEach(() => { db = openDb(":memory:"); sheet = new FakeSheetGateway(); });
afterEach(() => db.close());
const t = (seconds: number) => new Date(Date.parse("2026-11-03T10:00:00Z") + seconds * 1000);

it("creates the sheet on the first round, then reads people's edits before writing, once a minute", async () => {
  const { lead } = addLead(db, { handle: "anna" }, "t");
  expect(await runSheetCycle(db, sheet, t(0))).toMatchObject({ toSheet: { ok: true, leads: 1 } });
  expect(await runSheetCycle(db, sheet, t(30))).toBeNull();
  sheet.tabs.get("Leads")!.rows[0][LEADS_HEADERS.indexOf("stage")] = "Qualified";
  sheet.tabs.get("Do-not-contact")!.rows.push(["newperson", "competitor", ""]);
  const round = await runSheetCycle(db, sheet, t(60));
  expect(round).toMatchObject({ fromSheet: { ok: true, stageChanges: 1, doNotContactAdded: 1 }, toSheet: { ok: true } });
  expect(getLead(db, lead.id)!.stage).toBe("qualified");
  expect(isDnc(db, "newperson")).toBe(true);
  expect(sheet.tabs.get("Leads")!.rows[0][LEADS_HEADERS.indexOf("stage")]).toBe("Qualified");
});

it("does not write over the Sheet when reading it failed, and recovers the next round", async () => {
  const { lead } = addLead(db, { handle: "bo" }, "t");
  await runSheetCycle(db, sheet, t(0));
  sheet.tabs.get("Leads")!.rows[0][LEADS_HEADERS.indexOf("stage")] = "Qualified";
  sheet.failOnce = "read:Do-not-contact";
  const failed = await runSheetCycle(db, sheet, t(60));
  expect(failed).toMatchObject({ fromSheet: { ok: false }, toSheet: { ok: false } });
  expect(sheet.tabs.get("Leads")!.rows[0][LEADS_HEADERS.indexOf("stage")]).toBe("Qualified");
  expect(await runSheetCycle(db, sheet, t(120))).toMatchObject({ fromSheet: { ok: true, stageChanges: 1 } });
  expect(getLead(db, lead.id)!.stage).toBe("qualified");
});
