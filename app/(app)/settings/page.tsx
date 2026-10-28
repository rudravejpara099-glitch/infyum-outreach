import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listDnc } from "@/lib/db/repos/dnc";
import { getSetting } from "@/lib/db/repos/settings";
import { ActionForm } from "@/components/action-form";
import { supportedTimeZones } from "./validation";
import { PageHeader } from "@/components/ui";
import { blockHandle, saveApifyCap, saveProspectFilters, saveSafety, saveTimeZone, saveWriting, unblockHandle } from "./actions";
import { parseProspectFilters } from "@/lib/domain/prospect-filters";
import { getWritingReadiness } from "@/lib/services/writing-readiness";
import { parseSafetySettings } from "@/lib/domain/safety-settings";
import { parseWritingSettings } from "@/lib/domain/writing-settings";
import { PORTFOLIO_LINK } from "@/lib/engine/prompts";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await requireUser();
  const db = (await getDb());
  const writing = await getWritingReadiness(user.hostChromeAllowed);
  const dnc = listDnc(db);
  const cap = getSetting(db, "apify_monthly_cap_usd");
  const portfolioLink = getSetting(db, "portfolio_link") ?? PORTFOLIO_LINK;
  const zone = getSetting(db, "team_timezone") ?? "America/New_York";
  const zones = [...new Set([...supportedTimeZones(), zone])].sort();
  const filters = parseProspectFilters(getSetting(db, "prospect_filters"));
  const safety = parseSafetySettings(getSetting(db, "safety_settings"));
  const writingSettings = parseWritingSettings(getSetting(db, "writing_settings"));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-5">
          <h2 className="text-base font-semibold">AI message writing</h2>
          <p className="mb-2 mt-2"><span className={`badge ${writing.available ? "badge-ok" : "badge-warn"}`}>{writing.title}</span></p>
          <p className="text-sm text-muted">{writing.detail}</p>
        </section>
        <section className="card p-5">
          <h2 className="text-base font-semibold">Link in first messages</h2>
          <p className="mb-3 mt-1 text-muted">The app includes this link in the second part of every first-contact message. This setting is managed for the whole team.</p>
          <a className="text-link break-all" href={portfolioLink} target="_blank" rel="noreferrer">{portfolioLink}</a>
        </section>
        <section className="card p-5">
          <h2 className="text-base font-semibold">Sender details and prompts</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Who the messages come from, and the instructions the writer follows. The word and emoji limits for comments and the three-message shape of a first DM are checked by the app whatever you write here. In the DM prompt, {"{sender}"} {"{company}"} {"{location}"} {"{offer}"} and {"{link}"} are filled in for you. Leave a box empty to go back to the standard wording.</p>
          <ActionForm action={saveWriting} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="senderName">Sender name</label><input id="senderName" name="senderName" maxLength={60} defaultValue={writingSettings.senderName} className="input" /></div>
              <div><label className="label" htmlFor="company">Company</label><input id="company" name="company" maxLength={80} defaultValue={writingSettings.company} className="input" /></div>
              <div><label className="label" htmlFor="location">Where you are based</label><input id="location" name="location" maxLength={80} defaultValue={writingSettings.location} className="input" /></div>
              <div><label className="label" htmlFor="offer">What you do</label><input id="offer" name="offer" maxLength={200} defaultValue={writingSettings.offer} className="input" /></div>
            </div>
            <div><label className="label" htmlFor="dmPrompt">First DM prompt</label><textarea id="dmPrompt" name="dmPrompt" rows={9} defaultValue={writingSettings.dmPrompt} className="input" /></div>
            <div><label className="label" htmlFor="commentPrompt">Comment prompt</label><textarea id="commentPrompt" name="commentPrompt" rows={4} defaultValue={writingSettings.commentPrompt} className="input" /></div>
            <button className="btn w-fit">Save sender details and prompts</button>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Prospect filters</h2>
          <p className="mb-3 mt-1 text-sm text-muted">A prospect must pass every rule before any engagement happens. Rules that need data we do not have yet, such as recent posts or engagement, are only applied when that data is known.</p>
          <ActionForm action={saveProspectFilters} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="minFollowers">Minimum followers</label><input id="minFollowers" name="minFollowers" type="number" min={0} defaultValue={filters.minFollowers} className="input" /></div>
              <div><label className="label" htmlFor="maxFollowers">Maximum followers</label><input id="maxFollowers" name="maxFollowers" type="number" min={1} defaultValue={filters.maxFollowers} className="input" /></div>
              <div><label className="label" htmlFor="recentDays">Recent activity window (days)</label><input id="recentDays" name="recentDays" type="number" min={1} defaultValue={filters.recentDays} className="input" /></div>
              <div><label className="label" htmlFor="minRecentPosts">Minimum posts in that window</label><input id="minRecentPosts" name="minRecentPosts" type="number" min={0} defaultValue={filters.minRecentPosts} className="input" /></div>
              <div><label className="label" htmlFor="minEngagementPct">Minimum engagement (% of followers, 0 = off)</label><input id="minEngagementPct" name="minEngagementPct" type="number" min={0} max={100} step="0.1" defaultValue={filters.minEngagementPct} className="input" /></div>
              <div><label className="label" htmlFor="fitThreshold">Fit score needed (0 to 100, 0 = off)</label><input id="fitThreshold" name="fitThreshold" type="number" min={0} max={100} defaultValue={filters.fitThreshold} className="input" /></div>
            </div>
            <div><label className="label" htmlFor="nicheKeywords">Niche keywords (bio must mention one; empty = any)</label><textarea id="nicheKeywords" name="nicheKeywords" rows={2} defaultValue={filters.nicheKeywords.join(", ")} className="input" /></div>
            <div><label className="label" htmlFor="excludeKeywords">Skip bios that mention</label><textarea id="excludeKeywords" name="excludeKeywords" rows={2} defaultValue={filters.excludeKeywords.join(", ")} className="input" /></div>
            <div><label className="label" htmlFor="markets">Preferred markets</label><textarea id="markets" name="markets" rows={1} defaultValue={filters.markets.join(", ")} className="input" /></div>
            <button className="btn w-fit">Save filters</button>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Lead search (Apify)</h2>
          <p className="mb-2 mt-1 text-sm text-muted">Connection details: {user.hostChromeAllowed && process.env.APIFY_TOKEN ? "set up for this workspace" : "not set up for this workspace"}. Checking this does not run a search.</p>
          <p className="mb-3 mt-1 text-muted">{cap ? `Monthly limit: $${cap}. The app stops searching before it goes over.` : "Switched off. Set a monthly limit in dollars to turn it on. Leave the limit empty or use 0 to keep searches off."}</p>
          <ActionForm action={saveApifyCap} className="flex flex-wrap items-end gap-2">
            <div className="w-40"><label className="label" htmlFor="cap">Monthly limit (USD)</label><input id="cap" name="cap" type="number" min={0} step="0.000001" defaultValue={cap ?? ""} className="input" /></div>
            <button className="btn">Save</button>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Daily caps and active hours</h2>
          <p className="mb-3 mt-1 text-muted">Accounts only act between the start and end hour in the team time zone below, with breaks. Start and finish times vary slightly by account. The caps are the most each account does in a day; the slow week-one start-up still applies on top, and a cap of 0 switches that action off.</p>
          <ActionForm action={saveSafety} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="dayStartHour">Start hour (0 to 23)</label><input id="dayStartHour" name="dayStartHour" type="number" min={0} max={23} defaultValue={safety.dayStartHour} className="input" /></div>
              <div><label className="label" htmlFor="dayEndHour">End hour (1 to 24)</label><input id="dayEndHour" name="dayEndHour" type="number" min={1} max={24} defaultValue={safety.dayEndHour} className="input" /></div>
              <div><label className="label" htmlFor="followsCap">Follows per day</label><input id="followsCap" name="followsCap" type="number" min={0} max={1000} defaultValue={safety.caps.follows} className="input" /></div>
              <div><label className="label" htmlFor="likesCap">Likes per day</label><input id="likesCap" name="likesCap" type="number" min={0} max={1000} defaultValue={safety.caps.likes} className="input" /></div>
              <div><label className="label" htmlFor="commentsCap">Comments per day</label><input id="commentsCap" name="commentsCap" type="number" min={0} max={1000} defaultValue={safety.caps.comments} className="input" /></div>
              <div><label className="label" htmlFor="dmsCap">DMs per day</label><input id="dmsCap" name="dmsCap" type="number" min={0} max={1000} defaultValue={safety.caps.dms} className="input" /></div>
            </div>
            <button className="btn w-fit">Save caps and hours</button>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Team time zone</h2>
          <p className="mb-3 mt-1 text-muted">The active hours above are read in this time zone.</p>
          <ActionForm action={saveTimeZone}>
            <label className="label" htmlFor="timeZone">Time zone</label>
            <input id="timeZone" name="timeZone" list="team-time-zones" defaultValue={zone} className="input" required autoComplete="off" />
            <datalist id="team-time-zones">{zones.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</datalist>
            <button className="btn w-fit">Save time zone</button>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Do not contact</h2>
          <ActionForm action={blockHandle} className="my-3 grid gap-2 sm:grid-cols-3">
            <div><label className="label" htmlFor="blockedHandle">Instagram handle</label><input id="blockedHandle" name="handle" required maxLength={31} placeholder="@handle" className="input" /></div>
            <div><label className="label" htmlFor="blockedReason">Reason (optional)</label><input id="blockedReason" name="reason" maxLength={500} className="input" /></div>
            <button className="btn self-end">Add</button>
          </ActionForm>
          {dnc.length === 0 ? <p className="text-muted">Nobody blocked.</p> : (
            <ul className="divide-y divide-line">
              {dnc.map((d) => (
                <li key={d.handle} className="flex flex-wrap items-center justify-between gap-3 py-2"><span>@{d.handle} <span className="text-muted">{d.reason}</span></span>
                  <ActionForm action={unblockHandle}><input type="hidden" name="handle" value={d.handle} /><button className="btn">Remove</button></ActionForm></li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Team</h2>
          <p className="mt-2 text-muted">Invite teammates, manage access or switch company workspaces.</p>
          <Link className="btn mt-3" href="/workspaces">Team & workspaces</Link>
        </section>
      </div>
    </>
  );
}
