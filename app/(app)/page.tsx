import { stageCopy, activityLabel } from "@/lib/ui/copy";
import { listCampaigns } from "@/lib/db/repos/campaigns";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { dashboardData } from "@/lib/queries/dashboard";
import { listActivity } from "@/lib/db/repos/activity";
import { STAGES, type Stage } from "@/lib/domain/stages";
import { ago, number, todayIso } from "@/lib/format";
import { Empty, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireUser();
  const db = getDb();
  const d = dashboardData(db, todayIso());
  const campaigns = listCampaigns(db);
  const recent = listActivity(db, { limit: 8 });
  const funnel = STAGES.filter((s): s is Exclude<Stage, "skipped"> => s !== "skipped");
  const max = Math.max(1, ...funnel.map((s) => d.stages[s] ?? 0));

  return (
    <>
      <PageHeader title="Overview" sub="What is happening across every campaign." />
      {(d.accounts.length === 0 || campaigns.length === 0) && <section className="card mb-6 p-5"><h2 className="font-semibold">{d.accounts.length === 0 ? "Add your Instagram account" : "Create your first campaign"}</h2><p className="my-2 text-muted">Add the Instagram account you’ll use, then choose who you want to reach. Keep message review on while you get started.</p><div className="flex flex-wrap gap-3"><Link className={`btn ${d.accounts.length === 0 ? "btn-primary" : ""}`} href="/accounts">{d.accounts.length ? "Manage Instagram accounts" : "1. Add Instagram account"}</Link>{campaigns.length === 0 && <Link className={`btn ${d.accounts.length ? "btn-primary" : ""}`} href="/campaigns/new">{d.accounts.length ? "Create campaign" : "2. Create campaign"}</Link>}</div></section>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Leads" value={number(d.totalLeads)} />
        <Stat label="Messages sent today" value={d.sentToday} hint={`${d.sentWeek} in the last 7 days`} />
        <Stat label="Replies" value={(d.stages.replied ?? 0) + (d.stages.call_offered ?? 0)} />
        <Stat label="Calls booked" value={d.stages.booked ?? 0} />
      </div>

      {d.pending > 0 && (
        <Link href="/approvals" className="card mt-4 flex items-center justify-between border-accent bg-accent-soft p-4 text-accent-strong">
          <span className="font-medium">{d.pending} message{d.pending === 1 ? "" : "s"} waiting for your approval</span>
          <span>Review →</span>
        </Link>
      )}
      {d.failedJobs > 0 && (
        <div className="card mt-4 border-bad bg-bad-soft p-4 text-bad">{d.failedJobs} task{d.failedJobs === 1 ? "" : "s"} {d.failedJobs === 1 ? "needs" : "need"} attention. <Link href="/activity" className="underline">View history</Link></div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-base font-semibold">Lead progress</h2>
          <div className="flex flex-col gap-2.5">
            {funnel.map((s) => (
              <Link key={s} href={`/pipeline#${s}`} className="group flex items-center gap-3">
                <span className="w-32 text-muted group-hover:text-ink">{stageCopy[s].label}</span>
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
            <p className="text-muted">No Instagram account added yet. <Link href="/accounts" className="text-accent underline">Add an account</Link>.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {d.accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">@{a.handle}</div>
                    <div className="text-xs text-muted">{a.status === "active" ? `${a.sentToday} messages sent · ${a.allowance} allowed today` : a.status === "blocked" ? "Instagram needs attention" : "Paused"}</div>
                  </div>
                  <span className={`badge ${a.status === "active" ? "badge-ok" : "badge-warn"}`}>{a.sentToday} / {a.allowance}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Recent history</h2><Link href="/activity" className="text-accent">View history</Link></div>
        {recent.length === 0 ? <Empty title="Nothing yet" /> : (
          <ul className="divide-y divide-line">
            {recent.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span><span className="font-medium">{activityLabel(a.action)}</span></span>
                <span className="text-xs text-muted">{ago(a.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
