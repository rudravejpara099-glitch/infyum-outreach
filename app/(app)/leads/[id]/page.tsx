import { ActivityDetail } from "@/components/activity-detail";
import { FeedbackForm } from "@/components/feedback-form";
import { stageCopy, activityLabel, messageKindLabel, messageStatusLabel } from "@/lib/ui/copy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { getLead } from "@/lib/db/repos/leads";
import { listMessages } from "@/lib/db/repos/messages";
import { listActivity } from "@/lib/db/repos/activity";
import { isDnc } from "@/lib/db/repos/dnc";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { STAGES, canMove } from "@/lib/domain/stages";
import { ago, number, STAGE_BADGE } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { changeStage, doNotContact, saveNotes } from "../actions";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  await requireUser();
  const { id } = await params;
  const db = getDb();
  const lead = getLead(db, Number(id));
  if (!lead) notFound();
  const messages = listMessages(db, { leadId: lead.id }).reverse();
  const activity = listActivity(db, { leadId: lead.id, limit: 30 });
  const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
  const options = STAGES.filter((s) => s !== lead.stage && canMove(lead.stage, s));

  return (
    <>
      <PageHeader title={`@${lead.handle}`} sub={`${number(lead.followers)} followers${lead.niche ? ` · ${lead.niche}` : ""}${lead.country ? ` · ${lead.country}` : ""}`}
        actions={<a className="btn" href={`https://www.instagram.com/${lead.handle}/`} target="_blank" rel="noreferrer">Open on Instagram</a>} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className={`badge ${STAGE_BADGE[lead.stage]}`}>{stageCopy[lead.stage].label}</span>
        {lead.skipReason && <span className="text-muted">{lead.skipReason}</span>}
        {campaign && <Link href={`/campaigns/${campaign.id}`} className="text-accent">{campaign.name}</Link>}
        {isDnc(db, lead.handle) && <span className="badge badge-bad">Do not contact</span>}
        {lead.nextFollowupAt && <span className="text-muted">Next follow-up {lead.nextFollowupAt.slice(0, 10)}</span>}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section>
          <h2 className="mb-3 text-base font-semibold">Conversation</h2>
          {messages.length === 0 ? <p className="text-muted">No messages yet.</p> : (
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-xl rounded-2xl border px-4 py-3 ${m.direction === "out" ? "self-end border-transparent bg-accent-soft" : "self-start border-line bg-surface"}`}>
                  {m.parts.map((p, i) => <p key={i} className={i ? "mt-2" : ""}>{p}</p>)}
                  <div className="mt-2 text-xs text-muted">{m.direction === "out" ? `${messageKindLabel(m.kind)} · ${messageStatusLabel(m.status)}` : "Received"} · {ago(m.sentAt ?? m.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
          <h2 className="mb-3 mt-8 text-base font-semibold">History</h2>
          <ul className="divide-y divide-line text-sm">
            {activity.map((a) => <li key={a.id} className="flex justify-between py-1.5"><span>{activityLabel(a.action)}<ActivityDetail action={a.action} detail={a.detail} /></span><span className="text-xs text-muted">{ago(a.ts)}</span></li>)}
          </ul>
        </section>

        <aside className="flex flex-col gap-6">
          {options.length > 0 && (
            <section><h2 className="mb-2 text-base font-semibold">Update progress</h2>
              <p className="mb-3 text-sm text-muted">Choose a stage after that step has happened. This updates the record; it doesn’t contact the person.</p>
              <div className="flex flex-wrap gap-2">
                {options.map((s) => (
                  <FeedbackForm key={s} action={changeStage}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="to" value={s} /><button className="btn">Mark as {stageCopy[s].label.toLowerCase()}</button></FeedbackForm>
                ))}
              </div>
            </section>
          )}
          <section><h2 className="mb-2 text-base font-semibold">Notes</h2>
            <FeedbackForm action={saveNotes} className="flex flex-col gap-2"><input type="hidden" name="id" value={lead.id} />
              <textarea name="notes" rows={5} defaultValue={lead.notes} className="input" aria-label="Notes" /><button className="btn">Save notes</button></FeedbackForm></section>
          {!isDnc(db, lead.handle) && (
            <details><summary className="cursor-pointer font-semibold text-bad">Stop contacting this person</summary><p className="my-3 text-sm text-muted">Adds this handle to the do not contact list for every campaign. Future outreach to this person will stop.</p>
              <FeedbackForm action={doNotContact} className="flex flex-col gap-2"><input type="hidden" name="id" value={lead.id} />
                <input name="reason" placeholder="Reason (optional)" className="input" aria-label="Reason" />
                <button className="btn btn-danger">Add to do not contact</button></FeedbackForm></details>
          )}
        </aside>
      </div>
    </>
  );
}
