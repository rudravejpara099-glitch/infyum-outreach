import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listDnc } from "@/lib/db/repos/dnc";
import { getSetting } from "@/lib/db/repos/settings";
import { PageHeader } from "@/components/ui";
import { addTeammate, blockHandle, saveApifyCap, unblockHandle } from "./actions";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const me = await requireUser();
  const db = getDb();
  const dnc = listDnc(db);
  const users = db.prepare("SELECT name, email FROM users ORDER BY id").all() as { name: string; email: string }[];
  const cap = getSetting(db, "apify_monthly_cap_usd");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-5">
          <h2 className="text-base font-semibold">Lead search (Apify)</h2>
          <p className="mb-3 mt-1 text-muted">{cap ? `Monthly limit: $${cap}. The app stops searching before it goes over.` : "Switched off. Set a monthly limit in dollars to turn it on. Use 0 for the free plan only."}</p>
          <form action={saveApifyCap} className="flex items-end gap-2">
            <div className="w-40"><label className="label" htmlFor="cap">Monthly limit (USD)</label><input id="cap" name="cap" type="number" min={0} step="1" defaultValue={cap ?? ""} className="input" /></div>
            <button className="btn">Save</button>
          </form>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Do not contact</h2>
          <form action={blockHandle} className="my-3 flex gap-2">
            <input name="handle" required placeholder="@handle" className="input w-48" aria-label="Handle" />
            <input name="reason" placeholder="Reason (optional)" className="input" aria-label="Reason" />
            <button className="btn">Add</button>
          </form>
          {dnc.length === 0 ? <p className="text-muted">Nobody blocked.</p> : (
            <ul className="divide-y divide-line">
              {dnc.map((d) => (
                <li key={d.handle} className="flex items-center justify-between py-2"><span>@{d.handle} <span className="text-muted">{d.reason}</span></span>
                  <form action={unblockHandle}><input type="hidden" name="handle" value={d.handle} /><button className="btn">Remove</button></form></li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Team</h2>
          <ul className="my-3 divide-y divide-line">{users.map((u) => <li key={u.email} className="py-2">{u.name} <span className="text-muted">{u.email}{u.email === me.email ? " (you)" : ""}</span></li>)}</ul>
          <form action={addTeammate} className="grid grid-cols-3 gap-2">
            <input name="name" required placeholder="Name" className="input" aria-label="Name" />
            <input name="email" type="email" required placeholder="Email" className="input" aria-label="Email" />
            <input name="password" type="password" required minLength={8} placeholder="Password (8+)" className="input" aria-label="Password" />
            <button className="btn col-span-3 w-fit">Add teammate</button>
          </form>
        </section>
      </div>
    </>
  );
}
