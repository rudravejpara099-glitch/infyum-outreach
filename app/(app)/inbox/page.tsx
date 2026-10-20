import { FeedbackForm } from "@/components/feedback-form";
import { stageCopy, messageKindLabel, messageStatusLabel } from "@/lib/ui/copy";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listLeads } from "@/lib/db/repos/leads";
import { listMessages } from "@/lib/db/repos/messages";

import { ago } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";
import { changeStage } from "../leads/actions";
import { writeReply } from "./actions";

export const dynamic = "force-dynamic";

export default async function Inbox() {
  await requireUser();
  const db = getDb();
  const leads = [...listLeads(db, { stage: "replied" }), ...listLeads(db, { stage: "call_offered" })];
  return (
    <>
      <PageHeader title="Inbox" sub="People who wrote back. Save a reply here. It follows the campaign’s review setting before sending. Automatic replies are ignored." />
      {leads.length === 0 ? <Empty title="No replies yet">When someone answers a message, the conversation shows up here.</Empty> : (
        <div className="flex flex-col gap-4">
          {leads.map((l) => {
            const msgs = listMessages(db, { leadId: l.id, limit: 6 }).reverse();
            const queued = msgs.find((m) => m.direction === "out" && ["pending_approval", "approved"].includes(m.status));
            return (
              <article key={l.id} className="card p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Link href={`/leads/${l.id}`} className="font-medium text-accent">@{l.handle}</Link>
                  <span className="badge badge-ok">{stageCopy[l.stage].label}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {msgs.map((m) => (
                    <div key={m.id} className={`max-w-xl rounded-2xl px-4 py-2 ${m.direction === "out" ? "self-end bg-accent-soft" : "self-start border border-line"}`}>
                      {m.parts.join(" ")}
                      <div className="mt-1 text-xs text-muted">{m.direction === "out" ? `${messageKindLabel(m.kind)} · ${messageStatusLabel(m.status)}` : "reply"} · {ago(m.sentAt ?? m.createdAt)}</div>
                    </div>
                  ))}
                </div>
                {queued ? (
                  <p className="mt-3 text-xs text-muted">{queued.status === "pending_approval" ? "A reply is waiting for approval." : "A reply is approved and waiting to send."}</p>
                ) : (
                  <FeedbackForm action={writeReply} className="mt-3 flex gap-2">
                    <input type="hidden" name="id" value={l.id} />
                    <input name="text" required placeholder="Write a reply…" className="input" aria-label={`Reply to @${l.handle}`} />
                    <button className="btn btn-primary">Save reply</button>
                  </FeedbackForm>
                )}
                <div className="mt-3 flex gap-2">
                  {l.stage === "replied" && <FeedbackForm action={changeStage}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="to" value="call_offered" /><button className="btn">Mark as invited to a call</button></FeedbackForm>}
                  {l.stage === "call_offered" && <FeedbackForm action={changeStage}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="to" value="booked" /><button className="btn">Mark call as booked</button></FeedbackForm>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
