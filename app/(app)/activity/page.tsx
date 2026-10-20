import { activityLabel, actorLabel } from "@/lib/ui/copy";
import { ActivityDetail } from "@/components/activity-detail";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listActivity } from "@/lib/db/repos/activity";
import { listJobs } from "@/lib/db/repos/jobs";
import { ago } from "@/lib/format";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Activity() {
  await requireUser();
  const db = getDb();
  const rows = listActivity(db, { limit: 300 });
  const failed = listJobs(db, 200).filter((j) => j.status === "failed");
  return (
    <>
      <PageHeader title="History" sub="See what happened across the workspace, newest first."
        actions={<a href="/activity/export" className="btn">Download history</a>} />
      {failed.length > 0 && (
        <section className="card mb-6 border-bad p-4">
          <h2 className="mb-2 font-semibold text-bad">Tasks that need attention</h2>
          <ul className="text-sm">{failed.map((j) => <li key={j.id}>A task couldn’t finish. {j.leadId ? <Link className="text-accent" href={`/leads/${j.leadId}`}>lead {j.leadId}</Link> : ""} <ActivityDetail action={j.type} detail={j.lastError} /></li>)}</ul>
        </section>
      )}
      {rows.length === 0 ? <div className="card p-5"><h2 className="font-semibold">No history yet</h2><p className="mt-2 text-muted">Campaign changes, message reviews and Instagram activity will appear here.</p></div> : <ul className="card divide-y divide-line">
        {rows.map(a => <li key={a.id} className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-medium">{a.leadId ? <Link href={`/leads/${a.leadId}`} className="text-accent">{activityLabel(a.action)}</Link> : activityLabel(a.action)}</div>
            <span className="text-xs text-muted">{ago(a.ts)}</span>
          </div>
          <p className="mb-2 mt-1 break-words text-xs text-muted">{actorLabel(a.actor)}</p>
          <ActivityDetail action={a.action} detail={a.detail} />
        </li>)}
      </ul>}

    </>
  );
}
