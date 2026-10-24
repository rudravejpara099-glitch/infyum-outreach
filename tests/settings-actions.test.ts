import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { enqueue } from "@/lib/db/repos/jobs";
import { getSetting } from "@/lib/db/repos/settings";

const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ id: 1, email: "owner@example.test" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveTimeZone } from "@/app/(app)/settings/actions";

let db: Db;
beforeEach(() => { db = openDb(":memory:"); state.db = db; });
afterEach(() => { db.close(); state.db = null; });

describe("team time-zone settings action", () => {
  it("saves the time zone and makes only queued read-only checks eligible for reevaluation", async () => {
    enqueue(db, { type: "qualify" });
    enqueue(db, { type: "check_inbox" });
    enqueue(db, { type: "send" });
    db.prepare("UPDATE jobs SET run_after='2030-01-01 00:00:00'").run();

    const form = new FormData();
    form.set("timeZone", "Asia/Kolkata");
    const result = await saveTimeZone(form);

    expect(result.message).toContain("Queued lead and reply checks");
    expect(getSetting(db, "team_timezone")).toBe("Asia/Kolkata");
    expect(db.prepare("SELECT type,run_after FROM jobs ORDER BY id").all()).toEqual([
      { type: "qualify", run_after: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) },
      { type: "check_inbox", run_after: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) },
      { type: "send", run_after: "2030-01-01 00:00:00" },
    ]);
  });
});
