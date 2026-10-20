import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listLeads } from "@/lib/db/repos/leads";
import { listMessages } from "@/lib/db/repos/messages";
import { ago } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Our job ends at the first reply. This page is the hand-off list: open the chat in Instagram or GoHighLevel and take it from here. */
export default async function Replies() {
  await requireUser();
  const db = getDb();
  const leads = listLeads(db, { stage: "replied" });
  return (
    <>
      <PageHeader title="Replies" sub="People who wrote back. A person or the GoHighLevel agent takes it from here. Automatic replies are ignored." />
      {leads.length === 0 ? <Empty title="No replies yet">When someone answers a DM, they show up here.</Empty> : (
        <div className="flex flex-col gap-4">
          {leads.map((l) => {
            const last = listMessages(db, { leadId: l.id, limit: 6 }).find((m) => m.direction === "in");
            return (
              <article key={l.id} className="card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Link href={`/leads/${l.id}`} className="font-medium text-accent">@{l.handle}</Link>
                  {last && <span className="text-xs text-muted">{ago(last.sentAt ?? last.createdAt)}</span>}
                  <a className="btn ml-auto" href={`https://www.instagram.com/${l.handle}/`} target="_blank" rel="noreferrer">Open on Instagram</a>
                </div>
                {last && <div className="max-w-xl rounded-2xl border border-line px-4 py-2">{last.parts.join(" ")}</div>}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
