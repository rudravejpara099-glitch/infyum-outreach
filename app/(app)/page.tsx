import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { WorkerStatusRefresh } from "@/components/worker-status-refresh";
import { ActionForm } from "@/components/action-form";
import { startWorker, stopWorker } from "./worker/actions";
import { nextQueuedWork, workerStatus } from "@/lib/queries/worker-status";
import { workerStartProblem } from "@/lib/services/worker-start-readiness";
import { dashboardData } from "@/lib/queries/dashboard";
import { listActivity } from "@/lib/db/repos/activity";
import { STAGES, type Stage } from "@/lib/domain/stages";
import { ago, number } from "@/lib/format";
import { getSetting } from "@/lib/db/repos/settings";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import { stageCopy } from "@/lib/ui/copy";
import { activityLabel } from "@/lib/ui/copy";
import { failedWorkCopy, runningWorkerCopy } from "@/lib/ui/worker-status-copy";
import { PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireUser();
  const db = getDb();
  const worker = workerStatus(db, new Date());
  const nextWork = worker.running ? nextQueuedWork(db) : null;
  const workerProblem = workerStartProblem(db);
  const workerLabel = ({ running: "Outreach is running", starting: "Outreach is starting", stopping: "Outreach is stopping", unresponsive: "Outreach needs attention", legacy_running: "Outreach is running from a terminal", stopped: "Outreach is stopped" } as const)[worker.phase];
  const timeZone = getSetting(db, "team_timezone") ?? "America/New_York";
  const d = dashboardData(db, dateInTimeZone(new Date(), timeZone), timeZone);
  const failedCopy = failedWorkCopy(d.failedJobTypes);
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
            <p className="mt-1 text-sm text-muted">{d.accounts.length ? `${d.accounts.length} account${d.accounts.length === 1 ? "" : "s"} saved. Check Accounts to see which are signed in.` : "Add an account, then sign in by hand in the browser window."}</p>
            <Link href="/accounts" className="mt-3 inline-block text-sm text-accent underline">Go to Accounts</Link>
          </li>
          <li className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-xs font-medium text-muted">STEP 2</p>
            <p className="mt-1 font-medium">Keep Outreach running</p>
            <p className="mt-1 text-sm text-muted">{worker.running ? runningWorkerCopy(nextWork, new Date(), timeZone) : "Campaigns wait until Outreach’s background service starts on this computer. You can still connect an Instagram account."}</p>
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
      <section className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4" aria-label="Background service status">
        <div><span className={`badge ${worker.running ? "badge-ok" : "badge-warn"}`}>{workerLabel}</span>
          <p className="mt-2 text-sm text-muted">{worker.phase === "running" ? runningWorkerCopy(nextWork, new Date(), timeZone) : worker.phase === "stopping" ? "The current task can finish; no new tasks should start." : worker.phase === "starting" ? "The service is opening. Status will update shortly." : worker.phase === "unresponsive" ? "The process still exists but has not reported recently. Stop it and wait for its current task to finish." : worker.phase === "legacy_running" ? "This service was started in a terminal. Stop it there before using these controls." : "Campaign tasks are waiting. Account sign-in can still run separately."}</p>
          {!worker.running && worker.lastSeen && <p className="mt-1 text-xs text-muted">Last seen {ago(worker.lastSeen)}.</p>}
          {worker.phase === "stopped" && workerProblem && <p className="mt-2 text-sm text-warn">{workerProblem}</p>}
          {worker.phase === "stopped" && !workerProblem && <p className="mt-2 text-xs text-muted">Starting may process approved outreach tasks, including sending DMs. Turn on campaign approval before a live test.</p>}
        </div><div className="flex flex-wrap items-start gap-2">
          {worker.phase === "stopped" && !workerProblem && <ActionForm action={startWorker} className="flex flex-col gap-1"><button className="btn btn-primary">Start Outreach</button></ActionForm>}
          {(worker.phase === "running" || worker.phase === "starting" || worker.phase === "unresponsive") && <ActionForm action={stopWorker} className="flex flex-col gap-1"><button className="btn">Stop after current task</button></ActionForm>}
          <WorkerStatusRefresh /><Link href="/activity" className="btn">View activity</Link>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Leads" value={number(d.totalLeads)} />
        <Stat label="DMs sent today" value={d.sentToday} hint={`${d.sentWeek} in the last 7 days`} />
        <Stat label="Replies" value={d.stages.replied ?? 0} />
        <Stat label="Reply rate" value={`${Math.round(((d.stages.replied ?? 0) / Math.max(1, (d.stages.dm_sent ?? 0) + (d.stages.replied ?? 0))) * 100)}%`} hint="of leads we messaged" />
      </div>

      {d.pending > 0 && (
        <Link href="/approvals" className="card mt-4 flex items-center justify-between border-accent bg-accent-soft p-4 text-accent-strong">
          <span className="font-medium">{d.pending} message{d.pending === 1 ? "" : "s"} waiting for your approval</span>
          <span>Review →</span>
        </Link>
      )}
      {failedCopy && (
        <Link href="/activity" className="card mt-4 block border-bad bg-bad-soft p-4 text-bad">{failedCopy}{" "}<span className="underline">View activity →</span></Link>
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
          <h2 className="mb-4 text-base font-semibold">Accounts today</h2>
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
