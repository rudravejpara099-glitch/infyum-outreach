import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { openLoginWindowJob } from "@/lib/services/login-window-job";
import { PlaywrightInstagram } from "@/worker/instagram";

async function main() {
  const accountId = Number(process.argv[2]);
  const jobId = Number(process.argv[3]);
  if (!Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(jobId) || jobId < 1) throw new Error("A valid sign-in request is required");
  const db = openDb(config.dbPath);
  try {
    await openLoginWindowJob(db, jobId, accountId, new PlaywrightInstagram());
  } finally {
    db.close();
  }
}

void main().catch(() => process.exitCode = 1);
