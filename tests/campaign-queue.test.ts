import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { queueLeadSearch } from "@/app/(app)/campaigns/queue-search";
let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());
it("persists one active search per campaign without blocking a different campaign", () => {
  expect(queueLeadSearch(db, 1)).toBe(true);
  expect(queueLeadSearch(db, 1)).toBe(false);
  expect(queueLeadSearch(db, 2)).toBe(true);
  db.prepare("UPDATE jobs SET status='running' WHERE json_extract(payload,'$.campaignId')=1").run();
  expect(queueLeadSearch(db, 1)).toBe(false);
  expect((db.prepare("SELECT count(*) n FROM jobs").get() as { n: number }).n).toBe(2);
});
it("allows an explicit new search once the previous one is completed", () => {
  queueLeadSearch(db, 1); db.exec("UPDATE jobs SET status='done'");
  expect(queueLeadSearch(db, 1)).toBe(true);
  expect((db.prepare("SELECT count(*) n FROM jobs").get() as { n: number }).n).toBe(2);
});
