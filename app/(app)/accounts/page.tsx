import { FeedbackForm } from "@/components/feedback-form";
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
      <PageHeader title="Instagram accounts" sub="Add the Instagram account you’ll use for outreach. Sign in directly in its browser window; your Instagram password never enters this app." />
      <FeedbackForm action={connectAccount} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="w-56"><label className="label" htmlFor="handle">Instagram handle</label><input id="handle" name="handle" required placeholder="@yourbrand" className="input" /></div>
        <div className="w-40"><label className="label" htmlFor="dailyCap">Daily message limit (max {config.absoluteDailyCeiling})</label><input id="dailyCap" name="dailyCap" type="number" defaultValue={35} min={1} max={config.absoluteDailyCeiling} className="input" /></div>
        <button className="btn btn-primary">Add Instagram account</button>
        <p className="basis-full text-xs text-muted">The app requests a sign-in window on this computer. When it opens, sign in to Instagram there, then close it.</p>
      </FeedbackForm>

      <details className="mb-6 text-sm text-muted"><summary className="cursor-pointer">No sign-in window appeared?</summary><p className="mt-2">The automatic assistant needs to be running on this computer to open Instagram. Ask the person who set up the workspace to start it, then choose Sign in to Instagram. Adding an account here does not confirm that Instagram is signed in.</p></details>
      {accounts.length === 0 ? <Empty title="No accounts yet">Add the Instagram account you want to send messages from.</Empty> : (
        <div className="card divide-y divide-line">
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <div className="font-medium">@{a.handle} <span className={`badge ml-2 ${a.status === "active" ? "badge-ok" : a.status === "paused" ? "badge-warn" : "badge-bad"}`}>{{ active: "Enabled for outreach", paused: "Paused", blocked: "Instagram needs attention" }[a.status]}</span></div>
                <div className="mt-0.5 text-xs text-muted">
                  Today {sentTodayForAccount(db, a.id, today)} of {dailyAllowance(a, today)} allowed{a.statusNote ? ` · ${a.statusNote}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <FeedbackForm action={changeCap} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="cap" type="number" defaultValue={a.dailyCap} min={1} max={config.absoluteDailyCeiling} aria-label={`Daily message limit for @${a.handle}`} className="input w-20" />
                  <button className="btn">Save limit</button>
                </FeedbackForm>
                <FeedbackForm action={reopenLogin}><input type="hidden" name="id" value={a.id} /><button className="btn">Sign in to Instagram</button></FeedbackForm>
                {a.status !== "blocked" && <FeedbackForm action={changeStatus}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="status" value={a.status === "active" ? "paused" : "active"} />
                  <button className="btn">{a.status === "active" ? "Pause" : "Resume"}</button>
                </FeedbackForm>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
