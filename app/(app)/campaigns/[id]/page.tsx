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
import { ActionForm } from "@/components/action-form";
import { workerStatus } from "@/lib/queries/worker-status";
import { changeCampaignStatus, deleteEmptyDraftCampaign } from "../actions";
import { campaignHistory } from "@/lib/queries/campaign-history";
import { validTimeZone } from "../../settings/validation";
import { messageKindLabel } from "@/lib/ui/copy";
import { CAMPAIGN_STATUS_LABEL } from "@/components/campaign-status";
import { campaignSendBlockers, chromeWarmupNotice } from "@/lib/ui/campaign-send-readiness";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const db = getDb();
  const campaign = getCampaign(db, Number(id));
  if (!campaign) notFound();
  const worker = workerStatus(db, new Date());
  const overview = campaignOverview(db, campaign.id);
  const accounts = listAccounts(db);
  const selected = campaignAccountIds(db, campaign.id);
  const senderBlockers = campaignSendBlockers(accounts, selected);
  const warmupNotice = chromeWarmupNotice(accounts, selected, overview.stages.qualified ?? 0);
  const next = campaign.status === "active" ? { to: "paused", label: "Pause campaign" } : { to: "active", label: campaign.status === "draft" ? "Start campaign" : "Resume campaign" };
  const cap = getSetting(db, "apify_monthly_cap_usd");
  const savedZone = getSetting(db, "team_timezone") ?? "America/New_York";
  const timeZone = validTimeZone(savedZone) ? savedZone : "America/New_York";
  const reviewLink = `/approvals?campaign=${campaign.id}`;

  return <div className="campaign-workspace">
    <Link href="/campaigns" className="back-link"><Icon name="back" size={16} />Campaigns</Link>
    <header className="campaign-header">
      <div><div className="campaign-title"><h1>{campaign.name}</h1><span className={`status-label ${campaign.status === "active" ? "text-ok" : "text-muted"}`}><i />{CAMPAIGN_STATUS_LABEL[campaign.status]}</span></div>
        <p>{campaign.country} <span aria-hidden="true">·</span> {campaign.minFollowers.toLocaleString("en-US")}–{campaign.maxFollowers.toLocaleString("en-US")} followers</p>
      </div>
      {campaign.status !== "done" && <div className="flex flex-wrap gap-2">
        <ActionForm action={changeCampaignStatus}>
          <input type="hidden" name="id" value={campaign.id} /><input type="hidden" name="status" value={next.to} />
          <button className="btn">{campaign.status === "active" && <Icon name="pause" size={16} />}{next.label}</button>
        </ActionForm>
        <ActionForm action={changeCampaignStatus} confirmMessage="Stop this campaign? It will be marked finished and can’t be restarted. No new work will run. A message already being sent may still complete; saved drafts will remain in the campaign.">
          <input type="hidden" name="id" value={campaign.id} /><input type="hidden" name="status" value="done" />
          <button className="btn">Stop campaign</button>
        </ActionForm>
      </div>}
      {campaign.status === "draft" && overview.total === 0 && <ActionForm action={deleteEmptyDraftCampaign} className="campaign-delete-form" confirmMessage="Delete this empty draft campaign permanently? This can’t be undone.">
        <input type="hidden" name="id" value={campaign.id} />
        <button className="btn">Delete empty draft</button>
      </ActionForm>}
    </header>
    {campaign.status === "done" && <p className="card mb-4 p-4 text-sm text-muted">This campaign is finished. No new lead searches or messages will run. Any message already being sent may complete.</p>}
    {!worker.running && <p className="card mb-4 p-4 text-sm text-warn">Outreach is waiting. Campaign work will not start until its background service is running on this computer.</p>}
    {campaign.status === "active" && senderBlockers.length > 0 && <div className="card mb-4 border-warn bg-warn/5 p-4 text-sm" role="status">
      <p className="font-medium">This campaign can’t run yet</p>
      <p className="mt-1">{senderBlockers.join(" · ")}. Choose an account that is active and set up for campaign actions in <Link href="#settings" className="underline">Campaign settings</Link>.</p>
    </div>}
    {warmupNotice && <div className="card mb-4 border-warn bg-warn/5 p-4 text-sm" role="status">
      <p className="font-medium">Matched leads need preparation</p>
      <p className="mt-1">{warmupNotice.matchedLeadCount === 1 ? "This matched lead needs" : `These ${warmupNotice.matchedLeadCount} matched leads need`} Instagram activity before Outreach can prepare a first message. Signed-in Chrome supports this step. Automatic comments and drafts require a connected writing service and an approved spending limit.</p>
      <p className="mt-2 text-muted">To work without paid AI, complete the engagement on Instagram, open the lead and mark it Engaged, then write its three-part message. It will wait for your approval.</p>
      <Link href="/settings" className="mt-2 inline-flex underline">Review writing setup</Link>
    </div>}
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
        <Link href={`${reviewLink}#message-${m.id}`}><span className="avatar">{m.handle.slice(0, 2).toUpperCase()}</span><span><strong>@{m.handle}</strong><small>{messageKindLabel(m.kind)} · {m.partCount} separate message{m.partCount === 1 ? "" : "s"}</small></span><Icon name="chevron" size={18} /></Link>
      </li>)}</ul><Link href={reviewLink} className="text-link review-all">View all {overview.pendingCount} <Icon name="chevron" size={14} /></Link></>}
    </section>
    <section className="campaign-status" aria-labelledby="happening-title">
      <h2 id="happening-title">What’s happening</h2>
      <div className="status-row"><span className="status-icon"><Icon name="accounts" /></span><div><h3>{overview.total ? `${overview.total} ${overview.total === 1 ? "lead" : "leads"} in this campaign` : "Start with your first leads"}</h3><p>{overview.total ? "Open campaign progress to see where each lead stands." : "Add Instagram handles below to begin checking your audience."}</p></div><Link href={overview.total ? "#progress" : "#add-leads"} className="text-link">{overview.total ? "View progress" : "Add leads"}<Icon name="arrow" size={15} /></Link></div>
      <div className="status-row"><span className="status-icon"><Icon name="approval" /></span><div><h3>{campaign.approvalRequired ? "Messages wait for your approval" : "Campaign approval is off"}</h3><p>{campaign.approvalRequired ? "You review drafts before they can be queued to send." : "First-contact messages and follow-ups can be queued automatically. Outreach ends at the first real reply."}</p></div></div>
      <div className="status-row"><span className="status-icon"><Icon name="inbox" /></span><div><h3>{overview.conversations ? `${overview.conversations} conversation${overview.conversations === 1 ? "" : "s"} in Replies` : "Replies will appear in Replies"}</h3><p>{overview.conversations ? "Review the reply and hand the conversation to a person." : "When Outreach checks Instagram and finds a real reply, it stops outreach and hands the conversation over."}</p></div><Link href="/inbox" className="text-link">Open replies<Icon name="arrow" size={15} /></Link></div>
      {selected.length === 0 && <div className="connection-note"><Icon name="accounts" size={17} /><div className="connection-copy"><strong>No Instagram account selected</strong><p>{accounts.length ? "Choose a sender for this campaign, or add another account." : "Connect the Instagram account that will send this campaign’s messages."}</p></div><div className="connection-actions">{accounts.length > 0 && <Link href="#settings" className="btn">Choose sender</Link>}<Link href="/accounts" className="btn btn-primary">{accounts.length ? "Add Instagram account" : "Connect Instagram"}</Link></div></div>}
    </section>
    <CampaignDetails campaign={campaign} accounts={accounts} selected={selected} counts={overview.stages} leads={listLeads(db, { campaignId: campaign.id, limit: 12 })} searchOn={Number(cap) > 0} history={campaignHistory(db, campaign.id, timeZone)} timeZone={timeZone} />
  </div>;
}
