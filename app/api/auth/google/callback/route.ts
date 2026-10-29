import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, FLOW_COOKIE, googleKeys, openFlow, sameState, verifyIdToken } from "@/lib/auth/google";
import { appOrigin, googleEnabled, redirectUri, sessionKey } from "@/lib/auth/google-config";
import { linkGoogle, resolveGoogleUser } from "@/lib/auth/google-signin";
import { createSession, readSession } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/repos/activity";
import { getUser } from "@/lib/db/repos/users";
import { config } from "@/lib/config";
import { getIdentityDb, getWorkspaceDb } from "@/lib/workspaces/storage";
export const runtime = "nodejs";

/** Public on purpose: Google sends the browser here. Everything is checked below before any session is created. */
export async function GET(request: Request) {
  const origin = appOrigin(request), params = new URL(request.url).searchParams;
  const jar = await cookies();
  const flow = await openFlow(jar.get(FLOW_COOKIE)?.value, sessionKey());
  jar.delete({ name: FLOW_COOKIE, path: "/api/auth/google" });
  const to = (path: string, code: string) => NextResponse.redirect(new URL(`${path}?google=${code}`, origin));
  const failPath = flow?.intent === "link" ? "/settings" : "/login";
  if (!googleEnabled()) return to(failPath, "off");
  if (params.get("error")) return to(failPath, "denied");
  const code = params.get("code");
  if (!flow || !code || !sameState(params.get("state"), flow.state)) return to(failPath, "expired");

  let claims;
  try {
    const idToken = await exchangeCode({ code, verifier: flow.verifier, clientId: config.google.clientId, clientSecret: config.google.clientSecret, redirectUri: redirectUri(origin) });
    claims = await verifyIdToken(idToken, { clientId: config.google.clientId, nonce: flow.nonce, keys: googleKeys() });
  } catch { return to(failPath, "failed"); }

  const db = getIdentityDb();
  if (flow.intent === "link") {
    const session = await readSession();
    if (!session) return to("/login", "expired");
    const result = linkGoogle(db, session.userId, claims);
    if (!result.ok) return to("/settings", result.reason);
    const user = getUser(db, session.userId);
    logActivity(getWorkspaceDb(session.workspaceId), user?.email ?? "user", "auth.google_linked");
    return to("/settings", "linked");
  }
  const outcome = resolveGoogleUser(db, claims);
  if (!outcome.ok) return to("/login", outcome.reason);
  await createSession(outcome.user.id, outcome.workspaceId);
  logActivity(getWorkspaceDb(outcome.workspaceId), outcome.user.email, "auth.google_login");
  return NextResponse.redirect(new URL("/", origin));
}
