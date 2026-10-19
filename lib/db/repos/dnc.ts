import type { Db } from "../core";

export const normHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

export function addDnc(db: Db, handle: string, reason = ""): void {
  db.prepare("INSERT OR REPLACE INTO do_not_contact (handle, reason) VALUES (?, ?)").run(normHandle(handle), reason);
}
export function isDnc(db: Db, handle: string): boolean {
  return !!db.prepare("SELECT 1 FROM do_not_contact WHERE handle = ?").get(normHandle(handle));
}
export function listDnc(db: Db): { handle: string; reason: string; createdAt: string }[] {
  return (db.prepare("SELECT * FROM do_not_contact ORDER BY created_at DESC").all() as Record<string, string>[]).map((r) => ({
    handle: r.handle, reason: r.reason, createdAt: r.created_at,
  }));
}
export function removeDnc(db: Db, handle: string): void {
  db.prepare("DELETE FROM do_not_contact WHERE handle = ?").run(normHandle(handle));
}
