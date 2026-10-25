import Link from "next/link";
import { existsSync } from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/auth/dal";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { listDevices } from "@/lib/connectors/catalog";
import { PageHeader } from "@/components/ui";
import { DevicePairing } from "@/components/device-pairing";
import { ActionForm } from "@/components/action-form";
import { connectDeviceAccount, disconnectDevice } from "./actions";

export const dynamic = "force-dynamic";
export default async function ConnectPage() {
  const user = await requireUser();
  const devices = listDevices(getIdentityDb(), user.workspaceId), now = new Date().getTime();
  const ready = devices.filter(device => device.lastSeen && now - device.lastSeen < 30_000);
  const downloadable = existsSync(path.join(process.cwd(), "data", "connector-dist", `Outreach-Connector-macOS-${process.arch}.zip`));
  return <>
    <PageHeader title="Connect your Chrome" sub="Your Instagram sign-in stays on your computer. Outreach never asks for your Instagram password." actions={<Link href="/accounts" className="btn">Accounts</Link>} />
    <div className="grid max-w-3xl gap-5">
      <p role="status" className={`rounded-xl border p-3 text-sm ${ready.length ? "border-line text-ok" : "border-line text-muted"}`}>{ready.length ? `${ready.length} computer${ready.length === 1 ? " is" : "s are"} online. Choose your Instagram account below.` : devices.length ? "Your computer is offline. Reopen Outreach Connector to reconnect; your account stays saved." : "No computer connected yet. Complete these three steps once to get started."}</p>
      <section className="card p-5"><p className="text-xs text-muted">STEP 1</p><h2 className="mt-1 font-semibold">Open Outreach Connector</h2><p className="my-3 text-sm text-muted">Download the file, unzip it, then open Outreach Connector.app. Keep it and your signed-in Chrome open while campaigns run.</p>
        {downloadable ? <a href="/accounts/connect/download" className="btn btn-primary">Download for Mac</a> : <p className="text-sm text-warn">The connector download has not been published on this server yet.</p>}
        <p className="mt-3 text-sm text-muted">This download is for {process.arch === "arm64" ? "Apple silicon Macs" : "Intel Macs"}. Other computers are not supported by this build.</p>
        <p className="mt-3 text-sm text-warn">Preview app: not Apple verified. macOS may prevent it from opening. Contact your workspace administrator if that happens.</p>
      </section>
      <section className="card p-5"><p className="text-xs text-muted">STEP 2</p><h2 className="mb-3 mt-1 font-semibold">Pair with {user.workspaceName}</h2><DevicePairing /></section>
      <section className="card p-5"><p className="text-xs text-muted">STEP 3</p><h2 className="mt-1 font-semibold">Choose your Instagram account</h2><p className="my-3 text-sm text-muted">Open Instagram in the Chrome profile you already use and sign in there. The check below reads your account to confirm its handle; it sends nothing.</p>
        <details className="mb-4 rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Chrome connection help</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted"><li>In that Chrome profile, open <span className="break-all font-mono">chrome://inspect/#remote-debugging</span>.</li><li>Select “Enable remote debugging,” then allow Chrome’s access prompt when Outreach Connector connects. This gives the connector control of this Chrome profile, so use only the workspace website you recognize.</li><li>Keep Instagram and Outreach Connector open. If you switch Instagram accounts, run the account’s connection check again from Accounts.</li></ol></details>
        {ready.length ? <ActionForm action={connectDeviceAccount}>
          <div><label className="label" htmlFor="device">Your computer</label><select className="input" name="deviceId" id="device">{ready.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></div>
          <div><label className="label" htmlFor="deviceHandle">Instagram handle</label><input className="input" name="handle" id="deviceHandle" required placeholder="@yourbrand" /></div>
          <div><label className="label" htmlFor="deviceCap">DMs per day</label><input className="input" name="dailyCap" id="deviceCap" type="number" min={1} max={60} defaultValue={35} required /></div>
          <button className="btn btn-primary w-fit">Check my Instagram sign-in</button>
        </ActionForm> : <p className="text-sm text-muted">Waiting for your computer. Pair it above or reopen the connector; this page checks the connection automatically.</p>}
      </section>
      {devices.length > 0 && <section className="card p-5"><h2 className="font-semibold">Connected computers</h2><ul className="divide-y divide-line">{devices.map(device => <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><strong>{device.label}</strong><p className="text-sm text-muted">{ready.some(current => current.id === device.id) ? "Online" : "Offline · open the connector to resume"}</p></div>{(user.workspaceRole === "owner" || user.id === device.userId) && <ActionForm action={disconnectDevice}><input type="hidden" name="deviceId" value={device.id} /><button className="btn">Disconnect</button></ActionForm>}</li>)}</ul></section>}
    </div>
  </>;
}
