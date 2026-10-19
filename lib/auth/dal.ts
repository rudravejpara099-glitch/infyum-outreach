import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getUser, countUsers } from "@/lib/db/repos/users";
import { readSession } from "./session";

/** Every page and action that needs a signed-in user calls this. It is the real security check. */
export const requireUser = cache(async () => {
  const session = await readSession();
  const user = session ? getUser(getDb(), session.userId) : null;
  if (!user) redirect(countUsers(getDb()) === 0 ? "/setup" : "/login");
  return user;
});
