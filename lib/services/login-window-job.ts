import type { Db } from "@/lib/db/core";
import { completeJob, failJobPermanently } from "@/lib/db/repos/jobs";
import { getAccount, setAccountStatus } from "@/lib/db/repos/accounts";
import { loginCheckFailure } from "@/lib/domain/browser-mode";
import { canResumeAfterVerifiedSignIn } from "@/lib/domain/account-recovery";
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
    const authenticated = await driver.openLogin(account);
    db.transaction(() => {
      db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(JSON.stringify({ authenticated }), jobId);
      if (canResumeAfterVerifiedSignIn(account.status, account.statusNote, authenticated)) {
        setAccountStatus(db, accountId, "active", "", "worker");
      }
      completeJob(db, jobId);
    }).immediate();
  } catch (error) {
    const message = loginCheckFailure(error instanceof Error ? error.message : "");
    failJobPermanently(db, jobId, message);
    throw new Error(message);
  }
}
