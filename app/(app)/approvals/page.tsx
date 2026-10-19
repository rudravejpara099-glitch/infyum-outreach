import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listMessages } from "@/lib/db/repos/messages";
import { getLead } from "@/lib/db/repos/leads";
import { ago } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";
import { approve, reject } from "./actions";

export const dynamic = "force-dynamic";

export default async function Approvals() {
  await requireUser();
  const db = getDb();
  const pending = listMessages(db, { status: "pending_approval", limit: 100 }).reverse();
  return (
    <>
      <PageHeader title="Approvals" sub="Read it, change it if you want, then approve. Nothing here is sent until you do." />
      {pending.length === 0 ? <Empty title="Nothing waiting">New messages that need your OK appear here.</Empty> : (
        <div className="flex flex-col gap-4">
          {pending.map((m) => {
            const lead = getLead(db, m.leadId)!;
            return (
              <article key={m.id} className="card p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-accent">@{lead.handle}</Link>
                  <span className="badge badge-muted">{m.kind}</span>
                  {m.approvalReasons.map((r) => <span key={r} className="badge badge-warn">{r}</span>)}
                  <span className="ml-auto text-xs text-muted">{ago(m.createdAt)}</span>
                </div>
                <form action={approve} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  {m.parts.map((p, i) => <textarea key={i} name="part" defaultValue={p} rows={Math.max(2, Math.ceil(p.length / 90))} className="input" aria-label={`Message part ${i + 1}`} />)}
                  <div className="flex gap-2">
                    <button className="btn btn-primary">Approve and queue</button>
                    <button formAction={reject} className="btn btn-danger">Reject</button>
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
