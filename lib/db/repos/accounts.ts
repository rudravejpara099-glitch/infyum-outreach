import type { Db } from "../core";
import type { IgAccount } from "../types";
import { normHandle } from "./dnc";
import { logActivity } from "./activity";

const map = (r: Record<string, unknown>): IgAccount => ({
  id: r.id as number, handle: r.handle as string, label: r.label as string, profileDir: r.profile_dir as string,
  dailyCap: r.daily_cap as number, rampStart: r.ramp_start as string,
  status: r.status as IgAccount["status"], statusNote: r.status_note as string,
});

export function createAccount(db: Db, input: { handle: string; label?: string; profileDir: string; dailyCap?: number }, actor: string): IgAccount {
  const info = db
    .prepare("INSERT INTO ig_accounts (handle, label, profile_dir, daily_cap) VALUES (?,?,?,?)")
    .run(normHandle(input.handle), input.label ?? "", input.profileDir, input.dailyCap ?? 35);
  const acct = getAccount(db, Number(info.lastInsertRowid))!;
  logActivity(db, actor, "account.connected", { accountId: acct.id, detail: acct.handle });
  return acct;
}
export function getAccount(db: Db, id: number): IgAccount | null {
  const r = db.prepare("SELECT * FROM ig_accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
export function listAccounts(db: Db): IgAccount[] {
  return (db.prepare("SELECT * FROM ig_accounts ORDER BY handle").all() as Record<string, unknown>[]).map(map);
}
export function setAccountStatus(db: Db, id: number, status: IgAccount["status"], note: string, actor: string): void {
  db.prepare("UPDATE ig_accounts SET status = ?, status_note = ? WHERE id = ?").run(status, note, id);
  logActivity(db, actor, `account.${status}`, { accountId: id, detail: note });
}
export function setAccountCap(db: Db, id: number, cap: number, actor: string): void {
  db.prepare("UPDATE ig_accounts SET daily_cap = ? WHERE id = ?").run(cap, id);
  logActivity(db, actor, "account.cap", { accountId: id, detail: String(cap) });
}
