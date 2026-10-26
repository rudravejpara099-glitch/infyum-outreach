import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { config } from "@/lib/config";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { createWorkspaceSession, getMembership, listWorkspaces, revokeWorkspaceSession, validWorkspaceSession } from "@/lib/workspaces/catalog";

export const SESSION_COOKIE = "session";
const key = () => new TextEncoder().encode(config.sessionSecret);
type Session = { userId: number; workspaceId: string; sessionId: string };

/** A signed cookie selects a membership; the server record makes logout revocable. */
export async function createSession(userId: number, workspaceId?: string): Promise<void> {
  const db = getIdentityDb();
  const selected = workspaceId ?? listWorkspaces(db, userId)[0]?.id;
  if (!selected || !getMembership(db, userId, selected)) throw new Error("Choose a workspace you belong to.");
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  const sessionId = createWorkspaceSession(db, userId, selected, expires.getTime());
  try {
    const token = await new SignJWT({ uid: userId, wid: selected, sid: sessionId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(expires).sign(key());
    const cookieStore = await cookies();
    const previous = await readSession();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires, path: "/",
    });
    if (previous) revokeWorkspaceSession(db, previous.sessionId);
  } catch (error) {
    revokeWorkspaceSession(db, sessionId);
    throw error;
  }
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!Number.isSafeInteger(payload.uid) || Number(payload.uid) < 1 || typeof payload.wid !== "string" || typeof payload.sid !== "string") return null;
    const db = getIdentityDb(), userId = Number(payload.uid);
    if (!validWorkspaceSession(db, userId, payload.wid, payload.sid) || !getMembership(db, userId, payload.wid)) return null;
    return { userId, workspaceId: payload.wid, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const session = await readSession();
  if (session) revokeWorkspaceSession(getIdentityDb(), session.sessionId);
  (await cookies()).delete(SESSION_COOKIE);
}
