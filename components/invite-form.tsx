"use client";
import { useState } from "react";
import { ActionForm } from "./action-form";
import { inviteTeammate } from "@/app/(app)/workspaces/actions";

export function InviteForm() {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  return <div className="grid gap-3">
    <ActionForm action={async data => {
      const result = await inviteTeammate(data);
      setCopied(false);
      setLink(result.invitation ? `${window.location.origin}${result.invitation}` : "");
      return result;
    }}>
      <div><label className="label" htmlFor="inviteEmail">Teammate’s email</label><input className="input" id="inviteEmail" name="email" type="email" required maxLength={254} autoComplete="email" /></div>
      <button className="btn btn-primary w-fit">Create invitation</button>
    </ActionForm>
    {link && <div className="rounded-xl border border-line p-3">
      <label className="label" htmlFor="invitationLink">Invitation link</label>
      <input id="invitationLink" className="input" readOnly value={link} onFocus={event => event.currentTarget.select()} />
      <button className="btn mt-2" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { document.getElementById("invitationLink")?.focus(); } }}>{copied ? "Copied" : "Copy link"}</button>
      <p className="mt-2 text-xs text-muted">Only the invited email can use this link. A new invitation replaces the previous link.</p>
    </div>}
  </div>;
}
