import type { Db } from "@/lib/db/core";
import { getUser, type UserRow } from "@/lib/db/repos/users";
import { listWorkspaces } from "@/lib/workspaces/catalog";
import type { GoogleClaims } from "./google";

/**
 * Who may sign in with Google: only a person whose Google account was linked to their team account while they were
 * signed in some other way. It is never matched by email. Registration is open and emails are not verified here, so
 * matching by email would let someone pre-register a victim's address and inherit the victim's later Google sign-in.
 */
export type GoogleOutcome =
  | { ok: true; user: UserRow; workspaceId: string }
  | { ok: false; reason: "not_linked" | "no_workspace" };

export function resolveGoogleUser(db: Db, claims: GoogleClaims): GoogleOutcome {
  const linked = db.prepare("SELECT user_id FROM user_google WHERE sub = ?").get(claims.sub) as { user_id: number } | undefined;
  const user = linked ? getUser(db, linked.user_id) : null;
  if (!user) return { ok: false, reason: "not_linked" };
  const workspace = listWorkspaces(db, user.id)[0];
  return workspace ? { ok: true, user, workspaceId: workspace.id } : { ok: false, reason: "no_workspace" };
}

export type LinkOutcome = { ok: true } | { ok: false; reason: "taken" | "already_linked" };

/** Connects a Google account to the person who is signed in right now. One Google account per person, one person per Google account. */
export function linkGoogle(db: Db, userId: number, claims: GoogleClaims): LinkOutcome {
  return db.transaction((): LinkOutcome => {
    const owner = db.prepare("SELECT user_id FROM user_google WHERE sub = ?").get(claims.sub) as { user_id: number } | undefined;
    if (owner) return owner.user_id === userId ? { ok: true } : { ok: false, reason: "taken" };
    if (googleLinkOf(db, userId)) return { ok: false, reason: "already_linked" };
    db.prepare("INSERT INTO user_google (user_id, sub, email) VALUES (?, ?, ?)").run(userId, claims.sub, claims.email);
    return { ok: true };
  }).immediate();
}

export const googleLinkOf = (db: Db, userId: number): { email: string; linkedAt: string } | null => {
  const r = db.prepare("SELECT email, linked_at FROM user_google WHERE user_id = ?").get(userId) as { email: string; linked_at: string } | undefined;
  return r ? { email: r.email, linkedAt: r.linked_at } : null;
};
export const unlinkGoogle = (db: Db, userId: number): void => { db.prepare("DELETE FROM user_google WHERE user_id = ?").run(userId); };
