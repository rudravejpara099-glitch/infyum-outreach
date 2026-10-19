import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { config } from "@/lib/config";
import { listAccounts } from "@/lib/db/repos/accounts";
import { sentTodayForAccount } from "@/lib/db/repos/messages";
import { dailyAllowance } from "@/lib/domain/limits";
import { todayIso } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";
import { changeCap, changeStatus, connectAccount, reopenLogin } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireUser();
  const db = getDb();
  const today = todayIso();
  const accounts = listAccounts(db);
  return (
    <>
      <PageHeader title="Instagram accounts" sub="Each account runs in its own browser window. You log in once; the app never sees the password." />
      <form action={connectAccount} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="w-56"><label className="label" htmlFor="handle">Instagram handle</label><input id="handle" name="handle" required placeholder="@yourbrand" className="input" /></div>
        <div className="w-40"><label className="label" htmlFor="dailyCap">DMs per day (max {config.absoluteDailyCeiling})</label><input id="dailyCap" name="dailyCap" type="number" defaultValue={35} min={1} max={config.absoluteDailyCeiling} className="input" /></div>
        <button className="btn btn-primary">Connect account</button>
        <p className="basis-full text-xs text-muted">A browser window opens on this computer. Sign in to Instagram there, then close it.</p>
      </form>

      {accounts.length === 0 ? <Empty title="No accounts yet">Connect the Instagram account that will send the DMs.</Empty> : (
        <div className="card divide-y divide-line">
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <div className="font-medium">@{a.handle} <span className={`badge ml-2 ${a.status === "active" ? "badge-ok" : a.status === "paused" ? "badge-warn" : "badge-bad"}`}>{a.status}</span></div>
                <div className="mt-0.5 text-xs text-muted">
                  Today {sentTodayForAccount(db, a.id, today)} of {dailyAllowance(a, today)} allowed{a.statusNote ? ` · ${a.statusNote}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={changeCap} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="cap" type="number" defaultValue={a.dailyCap} min={1} max={config.absoluteDailyCeiling} aria-label="Daily cap" className="input w-20" />
                  <button className="btn">Set cap</button>
                </form>
                <form action={reopenLogin}><input type="hidden" name="id" value={a.id} /><button className="btn">Open login window</button></form>
                <form action={changeStatus}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="status" value={a.status === "active" ? "paused" : "active"} />
                  <button className="btn">{a.status === "active" ? "Pause" : "Resume"}</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
