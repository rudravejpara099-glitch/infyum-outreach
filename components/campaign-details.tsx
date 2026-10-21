import Link from "next/link";
import type { Campaign, IgAccount, Lead } from "@/lib/db/types";
import { STAGES } from "@/lib/domain/stages";
import { number, STAGE_BADGE } from "@/lib/format";
import { stageCopy } from "@/lib/ui/copy";
import { CampaignForm } from "./campaign-form";
import { Icon } from "./icon";
import { ActionForm } from "./action-form";
import { DisclosureLinks } from "./disclosure-links";
import { addLeads, findLeads } from "@/app/(app)/campaigns/actions";
import { CampaignHistory } from "./campaign-history";
import type { CampaignDay } from "@/lib/queries/campaign-history";

export function CampaignDetails({ campaign, accounts, selected, counts, leads, searchOn, history, timeZone }: {
  campaign: Campaign; accounts: IgAccount[]; selected: number[]; counts: Record<string, number>; leads: Lead[]; searchOn: boolean; history: CampaignDay[]; timeZone: string;
}) {
  const searchEnabled = searchOn && campaign.status === "active";
  const searchHint = campaign.status === "done" ? "This campaign is finished. Lead search is off." : campaign.status !== "active" ? "Start this campaign before searching for leads." : searchOn ? "Requires the worker and an Apify connection. Usage limits still apply." : "Search is off. Set a monthly cap in Settings first.";
  return <div className="campaign-disclosures">
    <DisclosureLinks />
    <details className="disclosure" id="progress">
      <summary><Icon name="pipeline" /><span>Campaign progress<small>See leads at each stage</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content"><div className="stage-grid">{STAGES.map(stage => <Link key={stage} href={`/pipeline?campaign=${campaign.id}#${stage}`} title={stageCopy[stage].description}><span>{stageCopy[stage].label}</span><strong>{counts[stage] ?? 0}</strong></Link>)}</div><CampaignHistory days={history} timeZone={timeZone} /></div>
    </details>
    <details className="disclosure" id="add-leads">
      <summary><Icon name="plus" /><span>Add leads<small>Paste handles, import a spreadsheet or search</small></span><Icon name="chevron" /></summary>
      {campaign.status === "done" ? <div className="disclosure-content"><p className="text-muted">This campaign is finished. You can review its leads and history, but cannot add more.</p></div> : <div className="disclosure-content add-leads-grid items-start">
        <ActionForm action={addLeads}>
          <input type="hidden" name="id" value={campaign.id} />
          <label className="label" htmlFor="handles">Instagram handles</label>
          <textarea name="handles" id="handles" rows={4} placeholder={"@handle1\n@handle2"} className="input" />
          <p className="help-text">One per line. Existing leads and do-not-contact handles are skipped.</p>
          <label className="label" htmlFor="lead-csv">Or choose a CSV file</label>
          <input type="file" name="csv" id="lead-csv" accept=".csv,text/csv" className="input" aria-describedby="csv-help" />
          <p id="csv-help" className="help-text">Up to 500 KB. Use a username, handle or Instagram URL column, or one handle per row. The file is read once and isn’t saved.</p>
          <button className="btn">Add to campaign</button>
        </ActionForm>
        <ActionForm action={findLeads}>
          <input type="hidden" name="id" value={campaign.id} />
          <h3>Find leads automatically</h3>
          <p className="help-text">Search for the audience saved in this campaign.</p>
          <button className="btn" disabled={!searchEnabled}>Queue lead search</button>
          <p className="help-text">{searchHint}</p>
        </ActionForm>
      </div>}
    </details>
    <details className="disclosure" id="leads">
      <summary><Icon name="accounts" /><span>Latest leads<small>{leads.length ? "Open a profile to see its history" : "Your campaign’s leads will appear here"}</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content">{leads.length === 0 ? <p className="text-muted">No leads yet. Add Instagram handles above to get started.</p> : <ul className="lead-list">{leads.map(l => <li key={l.id}><Link href={`/leads/${l.id}`}><span>@{l.handle}<small>{number(l.followers)} followers</small></span><span className={`badge ${STAGE_BADGE[l.stage]}`} title={stageCopy[l.stage].description}>{stageCopy[l.stage].label}</span><Icon name="chevron" size={16} /></Link></li>)}</ul>}</div>
    </details>
    <details className="disclosure" id="settings">
      <summary><Icon name="settings" /><span>Campaign settings<small>Audience, sending accounts, approvals and follow-ups</small></span><Icon name="chevron" /></summary>
      <div className="disclosure-content"><CampaignForm campaign={campaign} accounts={accounts} selected={selected} /></div>
    </details>
  </div>;
}
