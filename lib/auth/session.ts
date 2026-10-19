import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { config } from "@/lib/config";

export const SESSION_COOKIE = "session";
const key = () => new TextEncoder().encode(config.sessionSecret);

export async function createSession(userId: number): Promise<void> {
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(expires).sign(key());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires, path: "/",
  });
}

export async function readSession(): Promise<{ userId: number } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.uid === "number" ? { userId: payload.uid } : null;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
