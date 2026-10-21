import type { Db } from "@/lib/db/core";
import { completeJob, failJobPermanently } from "@/lib/db/repos/jobs";
import { getAccount } from "@/lib/db/repos/accounts";
import type { InstagramDriver } from "@/worker/driver";

export async function openLoginWindowJob(db: Db, jobId: number, accountId: number, driver: Pick<InstagramDriver, "openLogin">): Promise<void> {
  const job = db.prepare("SELECT type,account_id,status FROM jobs WHERE id=?").get(jobId) as { type: string; account_id: number | null; status: string } | undefined;
  if (!job || job.type !== "open_login" || job.account_id !== accountId || job.status !== "running") {
    throw new Error("The sign-in request is no longer available.");
  }
  const account = getAccount(db, accountId);
  if (!account) {
    failJobPermanently(db, jobId, "The saved Instagram account could not be found.");
    throw new Error("The saved Instagram account could not be found.");
  }
  try {
    await driver.openLogin(account);
    completeJob(db, jobId);
  } catch {
    failJobPermanently(db, jobId, "The sign-in window could not finish. Try again from Accounts.");
    throw new Error("The sign-in window could not finish. Try again from Accounts.");
  }
}
