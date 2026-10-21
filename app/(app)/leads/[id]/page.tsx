import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { getLead } from "@/lib/db/repos/leads";
import { listMessages } from "@/lib/db/repos/messages";
import { listActivity } from "@/lib/db/repos/activity";
import { isDnc } from "@/lib/db/repos/dnc";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { STAGES, STAGE_LABEL, canMove } from "@/lib/domain/stages";
import { ago, number, STAGE_BADGE } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";
import { changeStage, doNotContact, saveNotes } from "../actions";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
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
        <span className={`badge ${STAGE_BADGE[lead.stage]}`}>{STAGE_LABEL[lead.stage]}</span>
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
                  <div className="mt-2 text-xs text-muted">{m.direction === "out" ? m.kind : "reply"} · {m.status} · {ago(m.sentAt ?? m.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
          <h2 className="mb-3 mt-8 text-base font-semibold">History</h2>
          <ul className="divide-y divide-line text-sm">
            {activity.map((a) => <li key={a.id} className="flex justify-between py-1.5"><span>{a.action} <span className="text-muted">{a.detail}</span></span><span className="text-xs text-muted">{ago(a.ts)}</span></li>)}
          </ul>
        </section>

        <aside className="flex flex-col gap-6">
          {options.length > 0 && (
            <section><h2 className="mb-2 text-base font-semibold">Move to</h2>
              <div className="flex flex-wrap gap-2">
                {options.map((s) => (
                  <ActionForm key={s} action={changeStage}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="to" value={s} /><button className="btn" disabled={s === "found" && isDnc(db, lead.handle)}>{s === "found" ? "Re-run checks" : STAGE_LABEL[s]}</button></ActionForm>
                ))}
              </div>
              {lead.stage === "skipped" && <p className="mt-2 text-sm text-muted">Re-run checks after correcting the reason this lead was skipped. Requires an active campaign and a running worker. Do-not-contact and previously contacted leads stay stopped.</p>}
            </section>
          )}
          <section><h2 className="mb-2 text-base font-semibold">Notes</h2>
            <ActionForm action={saveNotes} className="flex flex-col gap-2"><input type="hidden" name="id" value={lead.id} />
              <textarea name="notes" rows={5} defaultValue={lead.notes} className="input" aria-label="Notes" /><button className="btn">Save notes</button></ActionForm></section>
          {!isDnc(db, lead.handle) && (
            <section><h2 className="mb-2 text-base font-semibold">Stop contact</h2>
              <ActionForm action={doNotContact} className="flex flex-col gap-2"><input type="hidden" name="id" value={lead.id} />
                <label className="label" htmlFor="stopReason">Reason (optional)</label><input id="stopReason" name="reason" maxLength={500} className="input" />
                <button className="btn btn-danger">Never contact again</button></ActionForm></section>
          )}
        </aside>
      </div>
    </>
  );
}
