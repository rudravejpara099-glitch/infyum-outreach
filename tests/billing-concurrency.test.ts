import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { openDb } from "@/lib/db/core";
import { saveCeiling } from "@/lib/billing/config";
import { claimResource } from "@/lib/billing/attribution";
it("serializes spend decisions across independent worker processes", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "billing-concurrency-")), file = path.join(temp, "db.sqlite");
  const db = openDb(file);
  try {
    db.exec("INSERT INTO users(id,email,name,password_hash) VALUES(1,'fixture@test.invalid','Fixture','fake'); INSERT INTO campaigns(id,name) VALUES(1,'Fixture'); INSERT INTO billing_integration_ack VALUES(1,'fixture','tests','2026-01-01'); INSERT INTO billing_model_rates(model,input_micros_per_million,output_micros_per_million,verified,source,created_at) VALUES('fixture',1000000,1000000,1,'test','2026-01-01');");
    saveCeiling(db, 1, 10000000, "2026-01-01T00:00:00.000Z"); claimResource(db, 1, "campaign", 1, "2026-01-01T00:00:00.000Z");
    const run = (operation: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/billing-reserve.ts", file, operation], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "", failure = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { failure += chunk; });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve(output) : reject(new Error(failure)));
    });
    const outcomes = await Promise.all([run("worker-a"), run("worker-b")]);
    expect(outcomes.sort()).toEqual(["refused", "reserved"]);
    expect((db.prepare("SELECT sum(max_cost_micros) n FROM billing_reservations WHERE status='held'").get() as { n: number }).n).toBe(5000000);
  } finally { db.close(); rmSync(temp, { recursive: true, force: true }); }
}, 10000);
