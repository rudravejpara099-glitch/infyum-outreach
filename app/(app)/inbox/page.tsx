import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listLeads } from "@/lib/db/repos/leads";
import { listMessages } from "@/lib/db/repos/messages";
import { ago } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Our job ends at the first message. This page lists everyone who has been handed over: open the chat in Instagram or GoHighLevel and take it from here. */
export default async function HandedOver() {
  await requireUser();
  const db = (await getDb());
  const leads = [...listLeads(db, { stage: "dm_sent" }), ...listLeads(db, { stage: "replied" })]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <PageHeader title="Handed over" sub="People we sent the first message to. A person or the GoHighLevel agent takes it from here; Outreach does nothing more with them." />
      {leads.length === 0 ? <Empty title="No one handed over yet">When the first message to a lead is sent, they show up here.</Empty> : (
        <div className="flex flex-col gap-4">
          {leads.map((l) => {
            const sent = listMessages(db, { leadId: l.id, limit: 6 }).find((m) => m.direction === "out" && m.kind === "dm" && m.status === "sent");
            return (
              <article key={l.id} className="card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Link href={`/leads/${l.id}`} className="font-medium text-accent">@{l.handle}</Link>
                  {sent && <span className="text-xs text-muted">Messaged {ago(sent.sentAt ?? sent.createdAt)}</span>}
                  <a className="btn ml-auto" href={`https://www.instagram.com/${l.handle}/`} target="_blank" rel="noreferrer">Open on Instagram</a>
                </div>
                {sent && <div className="max-w-xl rounded-2xl border border-line px-4 py-2">{sent.parts.join(" ")}</div>}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
