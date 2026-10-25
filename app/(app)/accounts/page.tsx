import Link from "next/link";
import { listDevices } from "@/lib/connectors/catalog";
import { getIdentityDb } from "@/lib/workspaces/storage";
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
import { accountStatusBadge, loginJobSummary } from "@/lib/ui/copy";
import { accountNeedsSignIn } from "@/lib/domain/account-recovery";
import { inboxReadConfirmsConnection } from "@/lib/domain/account-connection";
import type { Job } from "@/lib/db/types";
import { Empty, PageHeader } from "@/components/ui";
import { changeCap, changeStatus, connectAccount, reopenLogin, useSeparateSignIn, useSignedInChrome } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const user = await requireUser();
  const db = (await getDb());
  const timeZone = getSetting(db, "team_timezone") ?? "America/New_York";
  const today = dateInTimeZone(new Date(), timeZone);
  const accounts = listAccounts(db);
  const worker = workerStatus(db, new Date());
  const bindings = db.prepare("SELECT account_id,device_id FROM account_devices").all() as { account_id: number; device_id: string }[];
  const deviceByAccount = new Map(bindings.map(binding => [binding.account_id, binding.device_id]));
  const devices = listDevices(getIdentityDb(), user.workspaceId);
  const loginJobs = db.prepare("SELECT id,account_id,status,last_error,payload FROM jobs j WHERE type='open_login' AND account_id IS NOT NULL AND id=(SELECT MAX(j2.id) FROM jobs j2 WHERE j2.type='open_login' AND j2.account_id=j.account_id)").all() as { id: number; account_id: number; status: Job["status"]; last_error: string; payload: string }[];
  const loginJobByAccount = new Map(loginJobs.map((job) => [job.account_id, { id: job.id, status: job.status, lastError: job.last_error, payload: JSON.parse(job.payload) as Record<string, unknown> }]));
  const inboxEvidence = db.prepare(`SELECT account_id,
    MAX(CASE WHEN status='done' AND last_error='' THEN id ELSE 0 END) latest_success,
    MAX(CASE WHEN status='failed' THEN id ELSE 0 END) latest_failure
    FROM jobs WHERE type='check_inbox' AND account_id IS NOT NULL GROUP BY account_id`).all() as { account_id: number; latest_success: number; latest_failure: number }[];
  const inboxEvidenceByAccount = new Map(inboxEvidence.map((row) => [row.account_id, row]));
  return (
    <>
      <PageHeader title="Instagram accounts" sub="Sign in yourself in your existing Chrome or a separate sign-in window. Outreach never sees your password." />
      {!user.hostChromeAllowed && <section className="card mb-6 p-5"><h2 className="font-semibold">Connect Instagram on your computer</h2><p className="my-2 text-sm text-muted">Use your own signed-in Chrome. The sign-in stays on your device.</p><Link className="btn btn-primary" href="/accounts/connect">Connect my Chrome</Link></section>}
      {user.hostChromeAllowed && <ActionForm action={connectAccount} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="w-56"><label className="label" htmlFor="handle">Instagram handle</label><input id="handle" name="handle" required placeholder="@yourbrand" className="input" /></div>
        <div className="w-40"><label className="label" htmlFor="dailyCap">DMs per day (max {config.absoluteDailyCeiling})</label><input id="dailyCap" name="dailyCap" type="number" defaultValue={35} min={1} max={config.absoluteDailyCeiling} className="input" /></div>
        <div className="w-56"><label className="label" htmlFor="browserMode">How should it connect?</label><select id="browserMode" name="browserMode" defaultValue="isolated" className="input"><option value="isolated">New sign-in window</option>{user.hostChromeAllowed && <option value="chrome_read_only">My signed-in Chrome</option>}</select></div>
        <button className="btn btn-primary">Connect account</button>
        <p className="basis-full text-xs text-muted">Choose a separate sign-in window or your existing signed-in Chrome. Campaign messages still wait for approval when approval is turned on in campaign settings.</p>
      </ActionForm>}

      {!worker.running && <p className="card mb-4 p-4 text-sm text-warn">Campaign work is waiting for Outreach’s background service on this computer. You can still connect an Instagram account here.</p>}
      {accounts.length === 0 ? <Empty title="No accounts yet">Connect the Instagram account that will send the DMs.</Empty> : (
        <div className="card divide-y divide-line">
          {accounts.map((a) => {
            const device = devices.find(device => device.id === deviceByAccount.get(a.id));
            const isRemote = deviceByAccount.has(a.id);
            const signInRequired = accountNeedsSignIn(a.statusNote);
            const loginJob = loginJobByAccount.get(a.id) ?? null;
            const inbox = inboxEvidenceByAccount.get(a.id);
            const inboxVerified = inboxReadConfirmsConnection(a.status, loginJob?.id ?? null, inbox?.latest_success || null, inbox?.latest_failure || null);
            const signIn = loginJobSummary(loginJob, worker.running, isRemote ? "chrome_read_only" : a.browserMode, a.statusNote, inboxVerified);
            const statusBadge = accountStatusBadge(a.status, signIn.tone, a.statusNote);
            const signInTone = signIn.tone === "error" ? "border-bad bg-bad/5 text-bad" : signIn.tone === "success" ? "border-ok bg-ok/5 text-ok" : signIn.tone === "attention" ? "border-warn bg-warn/5 text-warn" : "border-line bg-panel text-muted";
            return <div key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className={`mb-3 max-w-2xl rounded-xl border p-3 ${signInTone}`} role={signIn.tone === "error" ? "alert" : "status"}>
                  <p className="text-sm font-medium">{signIn.title}</p>
                  <p className="mt-1 text-xs">{signIn.detail}</p>
                </div>
                <div className="font-medium break-words">@{a.handle} <span className={`badge ml-2 badge-${statusBadge.tone}`}>{statusBadge.label}</span></div>
                {a.browserMode === "chrome_read_only" && <p className="mt-2 max-w-lg text-sm text-muted">Uses your existing signed-in Chrome for this account. Campaign approval settings still control whether messages can be sent.</p>}
                {isRemote && <p className="mt-2 text-sm text-muted">{device ? `${device.label} · ${device.lastSeen && new Date().getTime() - device.lastSeen < 30_000 ? "Online" : "Offline: open Outreach Connector to resume"}` : "Computer disconnected. Reconnect in device setup."}</p>}
                <div className="mt-0.5 text-xs text-muted">
                  Today {sentTodayForAccount(db, a.id, today, timeZone)} of {dailyAllowance(a, today)} allowed{a.statusNote ? ` · ${a.statusNote}` : ""}
                </div>
                {a.status === "blocked" && !signInRequired && <p className="mt-2 max-w-lg text-sm text-bad">Instagram showed a warning. Outreach stays stopped. Opening the login window does not clear this warning.</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isRemote && <Link href="/accounts/connect" className="btn">Manage computer</Link>}
                <ActionForm action={changeCap} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="cap" type="number" defaultValue={a.dailyCap} min={1} max={config.absoluteDailyCeiling} aria-label="Daily cap" className="input w-20" />
                  <button className="btn">Set cap</button>
                </ActionForm>
                <ActionForm action={reopenLogin}><input type="hidden" name="id" value={a.id} /><button className="btn">{isRemote || a.browserMode === "chrome_read_only" ? "Check Chrome sign-in" : "Open login window"}</button></ActionForm>
                {!isRemote && user.hostChromeAllowed && a.browserMode !== "chrome_read_only" && <ActionForm action={useSignedInChrome}><input type="hidden" name="id" value={a.id} /><button className="btn">Use signed-in Chrome</button></ActionForm>}
                {!isRemote && a.browserMode === "chrome_read_only" && <ActionForm action={useSeparateSignIn}><input type="hidden" name="id" value={a.id} /><button className="btn">Use separate sign-in</button></ActionForm>}
                <ActionForm action={changeStatus}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="status" value={a.status === "active" ? "paused" : "active"} />
                  <button className="btn" disabled={a.status === "blocked"}>{a.status === "blocked" ? signInRequired ? "Sign-in needed" : "Stopped by Instagram" : a.status === "active" ? "Pause" : "Resume"}</button>
                </ActionForm>
              </div>
            </div>;
          })}
        </div>
      )}
    </>
  );
}
