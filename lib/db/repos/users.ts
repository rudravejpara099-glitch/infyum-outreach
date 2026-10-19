import type { Db } from "../core";

export type UserRow = { id: number; email: string; name: string; passwordHash: string };

const map = (r: Record<string, unknown>): UserRow => ({
  id: r.id as number, email: r.email as string, name: r.name as string, passwordHash: r.password_hash as string,
});

export function countUsers(db: Db): number {
  return (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
}
export function createUser(db: Db, email: string, name: string, passwordHash: string): UserRow {
  const info = db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)").run(email.toLowerCase().trim(), name.trim(), passwordHash);
  return getUser(db, Number(info.lastInsertRowid))!;
}
export function getUser(db: Db, id: number): UserRow | null {
  const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
export function findUserByEmail(db: Db, email: string): UserRow | null {
  const r = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
