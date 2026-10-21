import { openDb } from "@/lib/db/core";
import { reserveUsage } from "@/lib/billing/budget";
const db = openDb(process.argv[2]);
try {
  reserveUsage(db, { userId: 1, operationId: process.argv[3], provider: "ai", model: "fixture", maxCostMicros: 5000000, source: { campaignId: 1 }, now: "2026-01-01T00:00:00.000Z" });
  process.stdout.write("reserved");
} catch { process.stdout.write("refused"); }
finally { db.close(); }
