import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { getLead } from "@/lib/db/repos/leads";
import { listMessages } from "@/lib/db/repos/messages";
import { failedSendError } from "@/lib/db/repos/jobs";
import { listActivity } from "@/lib/db/repos/activity";
import { isDnc } from "@/lib/db/repos/dnc";
import { getCampaign, listCampaigns, campaignAccountIds } from "@/lib/db/repos/campaigns";
import { listAccounts } from "@/lib/db/repos/accounts";
import { activeJobExists, failedJobExists } from "@/lib/db/repos/jobs";
import { browserModeAllowsJob } from "@/lib/domain/browser-mode";
import { STAGES, canMove } from "@/lib/domain/stages";
import { ago, number, STAGE_BADGE } from "@/lib/format";
import { activityLabel, actorLabel, messageKindLabel, messageStatusLabel, stageCopy } from "@/lib/ui/copy";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";
import { changeStage, createManualFirstDm, doNotContact, moveLeadToCampaign, resolveUncertainSend, retryQualification, saveNotes } from "../actions";

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
  const hasFirstDm = messages.some((message) => message.direction === "out" && message.kind === "dm" && message.status !== "rejected");
  const accounts = listAccounts(db);
  const movableCampaigns = lead.stage === "found" && !isDnc(db, lead.handle) && messages.length === 0
    ? listCampaigns(db).filter((candidate) => candidate.id !== lead.campaignId && candidate.status === "active" && candidate.approvalRequired
      && accounts.some((account) => campaignAccountIds(db, candidate.id).includes(account.id) && account.status === "active" && browserModeAllowsJob(account.browserMode, "send")))
    : [];
  const hasFailedQualification = failedJobExists(db, "qualify", lead.id);
  const hasActiveQualification = activeJobExists(db, "qualify", lead.id);
  const canManageQualificationRetry = lead.stage === "found" && campaign?.status === "active" && !isDnc(db, lead.handle)
    && (hasFailedQualification || hasActiveQualification)
    && accounts.some((account) => campaignAccountIds(db, campaign.id).includes(account.id) && account.status === "active" && browserModeAllowsJob(account.browserMode, "qualify"));

  return (
    <>
      <PageHeader title={`@${lead.handle}`} sub={`${number(lead.followers)} followers${lead.niche ? ` · ${lead.niche}` : ""}${lead.country ? ` · ${lead.country}` : ""}`}
        actions={<a className="btn" href={`https://www.instagram.com/${lead.handle}/`} target="_blank" rel="noreferrer">Open on Instagram</a>} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className={`badge ${STAGE_BADGE[lead.stage]}`} title={stageCopy[lead.stage].description}>{stageCopy[lead.stage].label}</span>
        {lead.skipReason && <span className="text-muted">{lead.skipReason}</span>}
        {campaign && <Link href={`/campaigns/${campaign.id}`} className="text-accent">{campaign.name}</Link>}
        {isDnc(db, lead.handle) && <span className="badge badge-bad">Do not contact</span>}
        {lead.nextFollowupAt && <span className="text-muted">Next follow-up {lead.nextFollowupAt.slice(0, 10)}</span>}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section>
          <h2 className="mb-3 text-base font-semibold">Conversation</h2>
          {messages.length === 0 ? <p className="text-muted">No messages yet. Messages appear here after this lead has been contacted or replies.</p> : (
            <div className="flex flex-col gap-3">
              {messages.map((m) => {
                const sendError = m.direction === "out" && m.status === "failed" ? failedSendError(db, m.id) : null;
                const uncertain = /may have been sent/i.test(sendError ?? "");
                return <div key={m.id} className={`max-w-xl rounded-2xl border px-4 py-3 ${m.direction === "out" ? "self-end border-transparent bg-accent-soft" : "self-start border-line bg-surface"}`}>
                  {m.parts.map((p, i) => <p key={i} className={i ? "mt-2" : ""}>{p}</p>)}
                  <div className="mt-2 text-xs text-muted">{m.direction === "out" ? messageKindLabel(m.kind) : "Received"} · {messageStatusLabel(m.status)} · {ago(m.sentAt ?? m.createdAt)}</div>
                  {sendError && <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm">
                    <p className="font-medium">{uncertain ? "Check Instagram before deciding. The app could not confirm whether this message was sent." : "The app could not send this message. It is safe to return it to review."}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {uncertain && <ActionForm action={resolveUncertainSend} confirmMessage="Choose this only if every part of this message appears in the Instagram conversation.">
                        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="decision" value="sent" />
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirmedSent" required />I checked; all parts were sent.</label>
                        <button className="btn">Mark as sent</button>
                      </ActionForm>}
                      <ActionForm action={resolveUncertainSend} confirmMessage={uncertain ? "Choose this only if none of this message’s parts appear in the Instagram conversation. It will return to review and still needs approval before it can send." : "Return this unsent message to review. It will still need approval before it can send."}>
                        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="decision" value="unsent" />
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirmedUnsent" required />{uncertain ? "I checked; none were sent." : "Return this message to review."}</label>
                        <button className="btn">Return to review</button>
                      </ActionForm>
                    </div>
                    {uncertain && <p className="mt-2 text-xs text-muted">If only some parts appear, leave this message here and handle the conversation manually.</p>}
                  </div>}
                </div>;
              })}
            </div>
          )}
          <h2 className="mb-3 mt-8 text-base font-semibold">History</h2>
          {activity.length === 0 ? <p className="text-sm text-muted">Lead checks and changes will appear here as this person moves through the campaign.</p> : <ul className="divide-y divide-line text-sm">
            {activity.map((a) => <li key={a.id} className="flex justify-between py-1.5"><span>{activityLabel(a.action)} · {actorLabel(a.actor)} <span className="text-muted">{a.detail}</span></span><span className="text-xs text-muted">{ago(a.ts)}</span></li>)}
          </ul>}
        </section>

        <aside className="flex flex-col gap-6">
          {canManageQualificationRetry && (hasActiveQualification
            ? <section><h2 className="mb-2 text-base font-semibold">Lead check queued</h2><p className="text-sm text-muted">This read-only check will run when the background service is available.</p></section>
            : <section><h2 className="mb-2 text-base font-semibold">Lead check stopped</h2>
              <p className="mb-3 text-sm text-muted">Retry runs a read-only profile check. It won’t contact this person or use a paid provider.</p>
              <ActionForm action={retryQualification} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={lead.id} />
                <button className="btn">Retry lead check</button>
              </ActionForm>
            </section>)}
          {movableCampaigns.length > 0 && (
            <section><h2 className="mb-2 text-base font-semibold">Move to another campaign</h2>
              <p className="mb-3 text-sm text-muted">This lead has no conversation history. The new campaign will check it against its own rules before preparing a message.</p>
              <ActionForm action={moveLeadToCampaign} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={lead.id} />
                <label className="label" htmlFor="moveCampaign">Active campaign</label>
                <select className="input" id="moveCampaign" name="campaignId" required defaultValue="">
                  <option value="" disabled>Choose a campaign</option>
                  {movableCampaigns.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
                <button className="btn">Move lead</button>
              </ActionForm>
            </section>
          )}
          {options.length > 0 && (
            <section><h2 className="mb-2 text-base font-semibold">Move to</h2>
              <div className="flex flex-wrap gap-2">
                {options.map((s) => (
                  <ActionForm key={s} action={changeStage}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="to" value={s} /><button className="btn" disabled={s === "found" && isDnc(db, lead.handle)}>{s === "found" ? "Re-run checks" : stageCopy[s].label}</button></ActionForm>
                ))}
              </div>
              {lead.stage === "skipped" && <p className="mt-2 text-sm text-muted">Re-run checks after correcting the reason this lead was skipped. Requires an active campaign and a running worker. Do-not-contact and previously contacted leads stay stopped.</p>}
            </section>
          )}
          <section><h2 className="mb-2 text-base font-semibold">Notes</h2>
            <ActionForm action={saveNotes} className="flex flex-col gap-2"><input type="hidden" name="id" value={lead.id} />
              <textarea name="notes" rows={5} defaultValue={lead.notes} className="input" aria-label="Notes" /><button className="btn">Save notes</button></ActionForm></section>
          {campaign?.status === "active" && campaign.approvalRequired && lead.stage === "warmed" && !hasFirstDm && !isDnc(db, lead.handle) && (
            <section><h2 className="mb-2 text-base font-semibold">Write a first message</h2>
              <p className="mb-3 text-sm text-muted">Write three short parts. This does not call AI. The message goes to review and cannot send until you approve it.</p>
              <ActionForm action={createManualFirstDm} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={lead.id} />
                {[1, 2, 3].map((part) => <div key={part}><label className="label" htmlFor={`manual-part-${part}`}>Message {part}</label><textarea id={`manual-part-${part}`} name={`part${part}`} rows={3} className="input" required maxLength={380} /></div>)}
                <p className="text-xs text-muted">Include the campaign link once in message 2.</p>
                <button className="btn">Send to review</button>
              </ActionForm>
            </section>
          )}
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
