import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listDnc } from "@/lib/db/repos/dnc";
import { getSetting } from "@/lib/db/repos/settings";
import { ActionForm } from "@/components/action-form";
import { supportedTimeZones } from "./validation";
import { PageHeader } from "@/components/ui";
import { addTeammate, blockHandle, saveApifyCap, saveTimeZone, unblockHandle } from "./actions";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const me = await requireUser();
  const db = getDb();
  const dnc = listDnc(db);
  const users = db.prepare("SELECT name, email FROM users ORDER BY id").all() as { name: string; email: string }[];
  const cap = getSetting(db, "apify_monthly_cap_usd");
  const zone = getSetting(db, "team_timezone") ?? "America/New_York";
  const zones = [...new Set([...supportedTimeZones(), zone])].sort();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-5">
          <h2 className="text-base font-semibold">Lead search (Apify)</h2>
          <p className="mb-3 mt-1 text-muted">{cap ? `Monthly limit: $${cap}. The app stops searching before it goes over.` : "Switched off. Set a monthly limit in dollars to turn it on. Leave the limit empty or use 0 to keep searches off."}</p>
          <ActionForm action={saveApifyCap} className="flex flex-wrap items-end gap-2">
            <div className="w-40"><label className="label" htmlFor="cap">Monthly limit (USD)</label><input id="cap" name="cap" type="number" min={0} step="0.000001" defaultValue={cap ?? ""} className="input" /></div>
            <button className="btn">Save</button>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Team time zone</h2>
          <p className="mb-3 mt-1 text-muted">Accounts only work 9:00 to 21:00 in this time zone, with breaks. Start and finish times vary slightly by account.</p>
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
          <ul className="my-3 divide-y divide-line">{users.map((u) => <li key={u.email} className="break-words py-2">{u.name} <span className="text-muted">{u.email}{u.email === me.email ? " (you)" : ""}</span></li>)}</ul>
          <ActionForm action={addTeammate} className="grid gap-3 sm:grid-cols-3">
            <div><label className="label" htmlFor="teammateName">Name</label><input id="teammateName" name="name" required maxLength={100} className="input" autoComplete="name" /></div>
            <div><label className="label" htmlFor="teammateEmail">Email</label><input id="teammateEmail" name="email" type="email" required className="input" autoComplete="email" /></div>
            <div><label className="label" htmlFor="teammatePassword">Temporary password</label><input id="teammatePassword" name="password" type="password" required minLength={8} maxLength={200} className="input" autoComplete="new-password" /></div>
            <button className="btn sm:col-span-3 w-fit">Add teammate</button>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
