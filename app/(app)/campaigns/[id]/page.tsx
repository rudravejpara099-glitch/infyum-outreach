import { BillingForm } from "@/components/billing-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { campaignAccountIds, getCampaign } from "@/lib/db/repos/campaigns";
import { listAccounts } from "@/lib/db/repos/accounts";
import { listLeads } from "@/lib/db/repos/leads";
import { campaignOverview } from "@/lib/queries/campaign-overview";
import { getSetting } from "@/lib/db/repos/settings";
import { Icon } from "@/components/icon";
import { CampaignDetails } from "@/components/campaign-details";
import { SubmitButton } from "@/components/submit-button";
import { changeCampaignStatus } from "../actions";

export const dynamic = "force-dynamic";
const STATUS = { active: "Running", draft: "Draft", paused: "Paused", done: "Finished" };

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await params;
  const db = getDb();
  const campaign = getCampaign(db, Number(id));
  if (!campaign) notFound();
  const overview = campaignOverview(db, campaign.id);
  const accounts = listAccounts(db);
  const selected = campaignAccountIds(db, campaign.id);
  const next = campaign.status === "active" ? { to: "paused", label: "Pause campaign" } : { to: "active", label: campaign.status === "draft" ? "Start campaign" : "Resume campaign" };
  const cap = getSetting(db, "apify_monthly_cap_usd");
  const reviewLink = `/approvals?campaign=${campaign.id}`;

  return <div className="campaign-workspace">
    <Link href="/campaigns" className="back-link"><Icon name="back" size={16} />Campaigns</Link>
    <header className="campaign-header">
      <div><div className="campaign-title"><h1>{campaign.name}</h1><span className={`status-label ${campaign.status === "active" ? "text-ok" : "text-muted"}`}><i />{STATUS[campaign.status]}</span></div>
        <p>{campaign.country} <span aria-hidden="true">·</span> {campaign.minFollowers.toLocaleString("en-US")}–{campaign.maxFollowers.toLocaleString("en-US")} followers</p>
      </div>
      {campaign.status !== "done" && <BillingForm action={changeCampaignStatus}>
        <input type="hidden" name="id" value={campaign.id} /><input type="hidden" name="status" value={next.to} />
        <SubmitButton>{campaign.status === "active" && <Icon name="pause" size={16} />}{next.label}</SubmitButton>
      </BillingForm>}
    </header>
    <section className="audience-summary" aria-labelledby="audience-title">
      <div><h2 id="audience-title">Who you’re reaching</h2><p>{campaign.audienceText || campaign.niches.join(", ") || "Describe your audience in campaign settings."}</p></div>
      <Link href="#settings" className="text-link">Edit audience <Icon name="arrow" size={15} /></Link>
    </section>
    <section className="review-panel" aria-labelledby="review-title">
      <div className="review-heading"><span className={`review-symbol ${overview.pendingCount ? "text-warn" : "text-accent"}`}><Icon name={overview.pendingCount ? "clock" : "check"} size={24} /></span>
        <div><h2 id="review-title">{overview.pendingCount ? `${overview.pendingCount} draft${overview.pendingCount === 1 ? " needs" : "s need"} your review` : "You’re all caught up"}</h2>
          <p>{overview.pendingCount ? "Read the drafts before they enter the sending queue." : "Drafts that need your approval will appear here."}</p></div>
        {overview.pendingCount > 0 && <Link href={reviewLink} className="btn btn-primary">Review drafts <Icon name="arrow" size={17} /></Link>}
      </div>
      {overview.pending.length > 0 && <><ul className="review-list">{overview.pending.map(m => <li key={m.id}>
        <Link href={`${reviewLink}#message-${m.id}`}><span className="avatar">{m.handle.slice(0, 2).toUpperCase()}</span><span><strong>@{m.handle}</strong><small>{m.kind === "dm" ? "First contact" : m.kind === "followup" ? "Follow-up" : "Reply"} · {m.partCount} separate message{m.partCount === 1 ? "" : "s"}</small></span><Icon name="chevron" size={18} /></Link>
      </li>)}</ul><Link href={reviewLink} className="text-link review-all">View all {overview.pendingCount} <Icon name="chevron" size={14} /></Link></>}
    </section>
    <section className="campaign-status" aria-labelledby="happening-title">
      <h2 id="happening-title">What’s happening</h2>
      <div className="status-row"><span className="status-icon"><Icon name="accounts" /></span><div><h3>{overview.total ? `${overview.total} leads in this campaign` : "Start with your first leads"}</h3><p>{overview.total ? "Open campaign progress to see where each lead stands." : "Add Instagram handles below to begin checking your audience."}</p></div><Link href={overview.total ? "#progress" : "#add-leads"} className="text-link">{overview.total ? "View progress" : "Add leads"}<Icon name="arrow" size={15} /></Link></div>
      <div className="status-row"><span className="status-icon"><Icon name="approval" /></span><div><h3>{campaign.approvalRequired ? "Messages wait for your approval" : "Campaign approval is off"}</h3><p>{campaign.approvalRequired ? "You review drafts before they can be queued to send." : "Sensitive replies still require a person’s approval."}</p></div></div>
      <div className="status-row"><span className="status-icon"><Icon name="inbox" /></span><div><h3>{overview.conversations ? `${overview.conversations} conversation${overview.conversations === 1 ? "" : "s"} in your inbox` : "Replies will appear in your inbox"}</h3><p>{overview.conversations ? "Continue the conversation and choose the next step." : "Once the worker reads a reply, you can continue it there."}</p></div><Link href="/inbox" className="text-link">Open inbox<Icon name="arrow" size={15} /></Link></div>
      {selected.length === 0 && <p className="connection-note"><Icon name="accounts" size={17} />No sending account assigned. <Link href="#settings">Choose an account in campaign settings.</Link></p>}
    </section>
    <CampaignDetails campaign={campaign} accounts={accounts} selected={selected} counts={overview.stages} leads={listLeads(db, { campaignId: campaign.id, limit: 12 })} searchOn={cap !== null && cap !== ""} />
  </div>;
}
