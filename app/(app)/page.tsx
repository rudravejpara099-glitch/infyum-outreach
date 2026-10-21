import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { WorkerStatusRefresh } from "@/components/worker-status-refresh";
import { workerStatus } from "@/lib/queries/worker-status";
import { dashboardData } from "@/lib/queries/dashboard";
import { listActivity } from "@/lib/db/repos/activity";
import { STAGES, type Stage } from "@/lib/domain/stages";
import { ago, number, todayIso } from "@/lib/format";
import { stageCopy } from "@/lib/ui/copy";
import { activityLabel } from "@/lib/ui/copy";
import { PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireUser();
  const db = getDb();
  const worker = workerStatus(db, new Date());
  const d = dashboardData(db, todayIso());
  const recent = listActivity(db, { limit: 8 });
  const funnel = STAGES.filter((s): s is Exclude<Stage, "skipped"> => s !== "skipped");
  const max = Math.max(1, ...funnel.map((s) => d.stages[s] ?? 0));

  return (
    <>
      <PageHeader title="Overview" sub="What is happening across your campaigns." />
      <section className="card mb-4 p-5" aria-labelledby="getting-started-title">
        <h2 id="getting-started-title" className="text-base font-semibold">Get started</h2>
        <p className="mt-1 text-sm text-muted">A few steps get your workspace ready. Saving an Instagram account does not confirm that you are signed in.</p>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          <li className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-xs font-medium text-muted">STEP 1</p>
            <p className="mt-1 font-medium">Connect Instagram</p>
            <p className="mt-1 text-sm text-muted">{d.accounts.length ? `${d.accounts.length} account${d.accounts.length === 1 ? "" : "s"} saved. Open its login window and sign in by hand.` : "Add an account, then sign in by hand in the browser window."}</p>
            <Link href="/accounts" className="mt-3 inline-block text-sm text-accent underline">Go to Accounts</Link>
          </li>
          <li className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-xs font-medium text-muted">STEP 2</p>
            <p className="mt-1 font-medium">Start the background work</p>
            <p className="mt-1 text-sm text-muted">{worker.running ? "It is running on this computer." : "Saved tasks wait until the worker is started on this computer."}</p>
            <Link href="/accounts" className="mt-3 inline-block text-sm text-accent underline">See account setup</Link>
          </li>
          <li className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-xs font-medium text-muted">STEP 3</p>
            <p className="mt-1 font-medium">Prepare a campaign</p>
            <p className="mt-1 text-sm text-muted">{d.totalLeads ? `${number(d.totalLeads)} lead${d.totalLeads === 1 ? "" : "s"} in your workspace.` : "Choose who to reach and add a few leads to begin."}</p>
            <Link href="/campaigns" className="mt-3 inline-block text-sm text-accent underline">Go to Campaigns</Link>
          </li>
        </ol>
      </section>
      <section className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4" aria-label="Worker status">
        <div><span className={`badge ${worker.running ? "badge-ok" : "badge-warn"}`}>{worker.running ? "Worker running" : "Worker not running"}</span>
          <p className="mt-2 text-sm text-muted">{worker.running ? "The background worker is checking for tasks. Account hours, approvals and limits still apply." : "Saved tasks are waiting. The background worker needs to be started on this computer."}</p>
          {!worker.running && worker.lastSeen && <p className="mt-1 text-xs text-muted">Last seen {ago(worker.lastSeen)}.</p>}
        </div><div className="flex flex-wrap gap-2"><WorkerStatusRefresh /><Link href="/activity" className="btn">View activity</Link></div>
      </section>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Leads" value={number(d.totalLeads)} />
        <Stat label="DMs sent today (UTC)" value={d.sentToday} hint={`${d.sentWeek} in the last 7 days`} />
        <Stat label="Replies" value={d.stages.replied ?? 0} />
        <Stat label="Reply rate" value={`${Math.round(((d.stages.replied ?? 0) / Math.max(1, (d.stages.dm_sent ?? 0) + (d.stages.replied ?? 0))) * 100)}%`} hint="of leads we messaged" />
      </div>

      {d.pending > 0 && (
        <Link href="/approvals" className="card mt-4 flex items-center justify-between border-accent bg-accent-soft p-4 text-accent-strong">
          <span className="font-medium">{d.pending} message{d.pending === 1 ? "" : "s"} waiting for your approval</span>
          <span>Review →</span>
        </Link>
      )}
      {d.failedJobs > 0 && (
        <div className="card mt-4 border-bad bg-bad-soft p-4 text-bad">{d.failedJobs} background task{d.failedJobs === 1 ? "" : "s"} failed. See Activity.</div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-base font-semibold">Pipeline</h2>
          <div className="flex flex-col gap-2.5">
            {funnel.map((s) => (
              <Link key={s} href={`/pipeline#${s}`} className="group flex items-center gap-3">
                <span className="w-24 text-muted group-hover:text-ink" title={stageCopy[s].description}>{stageCopy[s].label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${((d.stages[s] ?? 0) / max) * 100}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums">{d.stages[s] ?? 0}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-base font-semibold">Accounts today (UTC)</h2>
          {d.accounts.length === 0 ? (
            <p className="text-muted">No Instagram account connected yet. <Link href="/accounts" className="text-accent underline">Connect one</Link>.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {d.accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">@{a.handle}</div>
                    <div className="text-xs text-muted">{a.status === "active" ? `Limit today ${a.allowance}` : a.statusNote || a.status}</div>
                  </div>
                  <span className={`badge ${a.status === "active" ? "badge-ok" : "badge-warn"}`}>{a.sentToday} / {a.allowance}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Recent activity</h2><Link href="/activity" className="text-accent">All activity</Link></div>
        {recent.length === 0 ? <div className="py-6 text-center">
          <p className="font-medium">No activity yet</p>
          <p className="mt-1 text-sm text-muted">Campaign changes and outreach updates will appear here as they happen.</p>
        </div> : (
          <ul className="divide-y divide-line">
            {recent.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span><span className="font-medium">{activityLabel(a.action)}</span> <span className="text-muted">{a.detail}</span></span>
                <span className="text-xs text-muted">{ago(a.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
