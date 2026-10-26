import type { Db } from "@/lib/db/core";
import { countUsers, createUser, type UserRow } from "@/lib/db/repos/users";

/** Only the initial workspace setup is public; the check and insert share a write lock. */
export function createFirstUser(db: Db, input: { email: string; name: string; passwordHash: string }): UserRow | null {
  return db.transaction(() => {
    if (countUsers(db) > 0) return null;
    return createUser(db, input.email, input.name, input.passwordHash);
  }).immediate();
}
