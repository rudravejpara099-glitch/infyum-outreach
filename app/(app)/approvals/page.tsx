import { FeedbackForm } from "@/components/feedback-form";
import { messageKindLabel } from "@/lib/ui/copy";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listMessages } from "@/lib/db/repos/messages";
import { getLead } from "@/lib/db/repos/leads";
import { ago } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";
import { approve, reject } from "./actions";
import { z } from "zod";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function Approvals({ searchParams }: PageProps<"/approvals">) {
  await requireUser();
  const db = getDb();
  const sp = await searchParams;
  const parsed = z.coerce.number().int().positive().safeParse(sp.campaign);
  if (sp.campaign !== undefined && !parsed.success) notFound();
  const campaignId = parsed.success ? parsed.data : undefined;
  const campaign = campaignId ? getCampaign(db, campaignId) : null;
  if (campaignId && !campaign) notFound();
  const pending = listMessages(db, { campaignId, status: "pending_approval", limit: 100, oldestFirst: true });
  return (
    <>
      <PageHeader title="Review messages" sub="Read and edit each draft, then approve it for sending. Approved messages wait for the account’s daily limit and sending schedule." />
      {campaign && <p className="mb-5 text-muted">{campaign.name} <span aria-hidden="true">·</span> <Link href="/approvals" className="text-accent">View all campaigns</Link></p>}
      {pending.length === 100 && <p className="mb-5 text-muted">Showing the first 100 waiting drafts, oldest first.</p>}
      {pending.length === 0 ? <Empty title="Nothing waiting">New messages that need your OK appear here.</Empty> : (
        <div className="flex flex-col gap-4">
          {pending.map((m) => {
            const lead = getLead(db, m.leadId)!;
            return (
              <article key={m.id} id={`message-${m.id}`} className="card p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-accent">@{lead.handle}</Link>
                  <span className="badge badge-muted">{messageKindLabel(m.kind)}</span>
                  {m.approvalReasons.map((r) => <span key={r} className="badge badge-warn">{r}</span>)}
                  <span className="ml-auto text-xs text-muted">{ago(m.createdAt)}</span>
                </div>
                <FeedbackForm action={approve} secondaryAction={reject} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  {m.parts.map((p, i) => <div key={i}><label className="label" htmlFor={`part-${m.id}-${i}`}>Message {i + 1}</label><textarea id={`part-${m.id}-${i}`} name="part" defaultValue={p} rows={Math.max(3, Math.ceil(p.length / 70))} className="input draft-input" /></div>)}
                  <div className="flex gap-2">
                    <SubmitButton primary>Approve for sending</SubmitButton>
                    <button type="submit" name="intent" value="secondary" className="btn btn-danger">Don’t send</button>
                  </div>
                </FeedbackForm>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
