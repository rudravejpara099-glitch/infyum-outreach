import { openDb } from "@/lib/db/core";
import { createFirstUser } from "@/lib/auth/first-user";
const db = openDb(process.argv[2]);
try {
  const user = createFirstUser(db, { email: process.argv[3], name: "Fixture", passwordHash: "fixture-hash-not-a-password" });
  process.stdout.write(JSON.stringify({ created: !!user }));
} finally { db.close(); }
