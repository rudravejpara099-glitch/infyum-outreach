import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listActivity } from "@/lib/db/repos/activity";
import { listJobs } from "@/lib/db/repos/jobs";
import { ago } from "@/lib/format";
import { activityLabel, actorLabel, jobErrorLabel, jobTypeLabel } from "@/lib/ui/copy";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Activity() {
  await requireUser();
  const db = getDb();
  const rows = listActivity(db, { limit: 300 });
  const failed = listJobs(db, 200).filter((j) => j.status === "failed");
  return (
    <>
      <PageHeader title="History" sub="See what happened in your workspace, newest first."
        actions={<a href="/activity/export" className="btn">Export CSV</a>} />
      {failed.length > 0 && (
        <section className="card mb-6 border-bad p-4">
          <h2 className="mb-2 font-semibold text-bad">Failed tasks</h2>
          <ul className="text-sm">{failed.map((j) => <li key={j.id}>{jobTypeLabel(j.type)} {j.leadId ? <Link className="text-accent" href={`/leads/${j.leadId}`}>lead {j.leadId}</Link> : ""} <span className="text-muted">{jobErrorLabel(j.type, j.lastError)}</span></li>)}</ul>
        </section>
      )}
      {rows.length === 0 ? <section className="card p-6 text-center" aria-labelledby="history-empty-title">
        <h2 id="history-empty-title" className="text-lg font-semibold">No history yet</h2>
        <p className="mt-1 text-muted">Campaign changes and outreach activity will appear here as they happen.</p>
        <Link href="/campaigns/new" className="mt-3 inline-block text-accent underline">Create a campaign</Link>
      </section> : <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Detail</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="td whitespace-nowrap text-muted">{ago(a.ts)}</td>
                <td className="td">{actorLabel(a.actor)}</td>
                <td className="td font-medium">{a.leadId ? <Link href={`/leads/${a.leadId}`} className="hover:text-accent">{activityLabel(a.action)}</Link> : activityLabel(a.action)}</td>
                <td className="td text-muted">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </>
  );
}
