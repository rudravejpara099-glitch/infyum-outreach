import Link from "next/link";
import type { Campaign, IgAccount, Lead } from "@/lib/db/types";
import { STAGES, STAGE_LABEL } from "@/lib/domain/stages";
import { number, STAGE_BADGE } from "@/lib/format";
import { CampaignForm } from "./campaign-form";
import { Icon } from "./icon";
import { SubmitButton } from "./submit-button";
import { DisclosureLinks } from "./disclosure-links";
import { addLeads, findLeads } from "@/app/(app)/campaigns/actions";

export function CampaignDetails({ campaign, accounts, selected, counts, leads, searchOn }: {
  campaign: Campaign; accounts: IgAccount[]; selected: number[]; counts: Record<string, number>; leads: Lead[]; searchOn: boolean;
}) {
  return <div className="campaign-disclosures">
    <DisclosureLinks />
    <details className="disclosure" id="progress">
      <summary><Icon name="pipeline" /><span>Campaign progress<small>See leads at each stage</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content stage-grid">{STAGES.map(stage => <Link key={stage} href={`/pipeline?campaign=${campaign.id}#${stage}`}><span>{STAGE_LABEL[stage]}</span><strong>{counts[stage] ?? 0}</strong></Link>)}</div>
    </details>
    <details className="disclosure" id="add-leads">
      <summary><Icon name="plus" /><span>Add leads<small>Paste handles or search for this audience</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content add-leads-grid">
        <form action={addLeads}>
          <input type="hidden" name="id" value={campaign.id} />
          <label className="label" htmlFor="handles">Instagram handles</label>
          <textarea name="handles" id="handles" required rows={4} placeholder={"@handle1\n@handle2"} className="input" />
          <p className="help-text">One per line. Existing leads and do-not-contact handles are skipped.</p>
          <SubmitButton>Add to campaign</SubmitButton>
        </form>
        <form action={findLeads}>
          <input type="hidden" name="id" value={campaign.id} />
          <h3>Find leads automatically</h3>
          <p className="help-text">Search for the audience saved in this campaign.</p>
          <SubmitButton disabled={!searchOn}>Queue lead search</SubmitButton>
          <p className="help-text">{searchOn ? "Requires the worker and an Apify connection. Usage limits still apply." : <>Search is off. Set a monthly cap in <Link href="/settings">Settings</Link> first.</>}</p>
        </form>
      </div>
    </details>
    <details className="disclosure" id="leads">
      <summary><Icon name="accounts" /><span>Latest leads<small>{leads.length ? "Open a profile to see its history" : "Your campaign’s leads will appear here"}</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content">{leads.length === 0 ? <p className="text-muted">No leads yet. Add Instagram handles above to get started.</p> : <ul className="lead-list">{leads.map(l => <li key={l.id}><Link href={`/leads/${l.id}`}><span>@{l.handle}<small>{number(l.followers)} followers</small></span><span className={`badge ${STAGE_BADGE[l.stage]}`}>{STAGE_LABEL[l.stage]}</span><Icon name="chevron" size={16} /></Link></li>)}</ul>}</div>
    </details>
    <details className="disclosure" id="settings">
      <summary><Icon name="settings" /><span>Campaign settings<small>Audience, sending accounts, approvals and booking link</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content"><CampaignForm campaign={campaign} accounts={accounts} selected={selected} /></div>
    </details>
  </div>;
}
