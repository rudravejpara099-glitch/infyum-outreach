import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { ActionForm } from "@/components/action-form";
import { workerStatus } from "@/lib/queries/worker-status";
import { config } from "@/lib/config";
import { listAccounts } from "@/lib/db/repos/accounts";
import { sentTodayForAccount } from "@/lib/db/repos/messages";
import { dailyAllowance } from "@/lib/domain/limits";
import { getSetting } from "@/lib/db/repos/settings";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import { loginJobSummary } from "@/lib/ui/copy";
import type { Job } from "@/lib/db/types";
import { Empty, PageHeader } from "@/components/ui";
import { changeCap, changeStatus, connectAccount, reopenLogin, useSeparateSignIn, useSignedInChrome } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireUser();
  const db = getDb();
  const timeZone = getSetting(db, "team_timezone") ?? "America/New_York";
  const today = dateInTimeZone(new Date(), timeZone);
  const accounts = listAccounts(db);
  const worker = workerStatus(db, new Date());
  const loginJobs = db.prepare("SELECT account_id,status,last_error,payload FROM jobs j WHERE type='open_login' AND account_id IS NOT NULL AND id=(SELECT MAX(j2.id) FROM jobs j2 WHERE j2.type='open_login' AND j2.account_id=j.account_id)").all() as { account_id: number; status: Job["status"]; last_error: string; payload: string }[];
  const loginJobByAccount = new Map(loginJobs.map((job) => [job.account_id, { status: job.status, lastError: job.last_error, payload: JSON.parse(job.payload) as Record<string, unknown> }]));
  return (
    <>
      <PageHeader title="Instagram accounts" sub="Each account runs in its own browser window. You log in once; the app never sees the password." />
      <ActionForm action={connectAccount} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="w-56"><label className="label" htmlFor="handle">Instagram handle</label><input id="handle" name="handle" required placeholder="@yourbrand" className="input" /></div>
        <div className="w-40"><label className="label" htmlFor="dailyCap">DMs per day (max {config.absoluteDailyCeiling})</label><input id="dailyCap" name="dailyCap" type="number" defaultValue={35} min={1} max={config.absoluteDailyCeiling} className="input" /></div>
        <div className="w-56"><label className="label" htmlFor="browserMode">How should it connect?</label><select id="browserMode" name="browserMode" defaultValue="isolated" className="input"><option value="isolated">New sign-in window</option><option value="chrome_read_only">My signed-in Chrome (read only)</option></select></div>
        <button className="btn btn-primary">Connect account</button>
        <p className="basis-full text-xs text-muted">The new window is ready for campaigns. Signed-in Chrome can confirm your account without exposing your password; campaign actions stay off in read-only mode.</p>
      </ActionForm>

      {!worker.running && <p className="card mb-4 p-4 text-sm text-warn">Campaign work is waiting for Outreach’s background service on this computer. You can still connect an Instagram account here.</p>}
      {accounts.length === 0 ? <Empty title="No accounts yet">Connect the Instagram account that will send the DMs.</Empty> : (
        <div className="card divide-y divide-line">
          {accounts.map((a) => {
            const signIn = loginJobSummary(loginJobByAccount.get(a.id) ?? null, worker.running);
            const signInTone = signIn.tone === "error" ? "border-bad bg-bad/5 text-bad" : signIn.tone === "success" ? "border-ok bg-ok/5 text-ok" : signIn.tone === "attention" ? "border-warn bg-warn/5 text-warn" : "border-line bg-panel text-muted";
            return <div key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className={`mb-3 max-w-2xl rounded-xl border p-3 ${signInTone}`} role={signIn.tone === "error" ? "alert" : "status"}>
                  <p className="text-sm font-medium">{signIn.title}</p>
                  <p className="mt-1 text-xs">{signIn.detail}</p>
                </div>
                <div className="font-medium break-words">@{a.handle} <span className={`badge ml-2 ${a.status === "active" ? "badge-ok" : a.status === "paused" ? "badge-warn" : "badge-bad"}`}>{a.status}</span></div>
                {a.browserMode === "chrome_read_only" && <p className="mt-2 max-w-lg text-sm text-muted">Uses your signed-in Chrome to confirm this account. Campaign actions are disabled for this connection.</p>}
                <div className="mt-0.5 text-xs text-muted">
                  Today {sentTodayForAccount(db, a.id, today, timeZone)} of {dailyAllowance(a, today)} allowed{a.statusNote ? ` · ${a.statusNote}` : ""}
                </div>
                {a.status === "blocked" && <p className="mt-2 max-w-lg text-sm text-bad">Instagram showed a warning. Outreach stays stopped. Opening the login window does not clear this warning.</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionForm action={changeCap} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="cap" type="number" defaultValue={a.dailyCap} min={1} max={config.absoluteDailyCeiling} aria-label="Daily cap" className="input w-20" />
                  <button className="btn">Set cap</button>
                </ActionForm>
                <ActionForm action={reopenLogin}><input type="hidden" name="id" value={a.id} /><button className="btn">Open login window</button></ActionForm>
                {a.browserMode !== "chrome_read_only" && <ActionForm action={useSignedInChrome}><input type="hidden" name="id" value={a.id} /><button className="btn">Use signed-in Chrome</button></ActionForm>}
                {a.browserMode === "chrome_read_only" && <ActionForm action={useSeparateSignIn}><input type="hidden" name="id" value={a.id} /><button className="btn">Use separate sign-in</button></ActionForm>}
                <ActionForm action={changeStatus}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="status" value={a.status === "active" ? "paused" : "active"} />
                  <button className="btn" disabled={a.status === "blocked"}>{a.status === "blocked" ? "Stopped by Instagram" : a.status === "active" ? "Pause" : "Resume"}</button>
                </ActionForm>
              </div>
            </div>;
          })}
        </div>
      )}
    </>
  );
}
