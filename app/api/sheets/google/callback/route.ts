import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { openFlow, sameState } from "@/lib/auth/google";
import { appOrigin, googleEnabled, sessionKey } from "@/lib/auth/google-config";
import { requireUser } from "@/lib/auth/dal";
import { logActivity } from "@/lib/db/repos/activity";
import { config } from "@/lib/config";
import { saveRefreshToken } from "@/lib/sheets/connection";
import { exchangeSheetsCode, SHEETS_FLOW_COOKIE } from "@/lib/sheets/oauth";
import { getWorkspaceDb } from "@/lib/workspaces/storage";
export const runtime = "nodejs";

/** Google sends the browser here. The attempt, the state and the signed-in session are all checked before anything is stored. */
export async function GET(request: Request) {
  const user = await requireUser();
  const origin = appOrigin(request), params = new URL(request.url).searchParams;
  const jar = await cookies();
  const flow = await openFlow(jar.get(SHEETS_FLOW_COOKIE)?.value, sessionKey());
  jar.delete({ name: SHEETS_FLOW_COOKIE, path: "/api/sheets/google" });
  const to = (code: string) => NextResponse.redirect(new URL(`/settings?sheets=${code}`, origin));
  if (!googleEnabled()) return to("off");
  if (params.get("error")) return to("denied");
  const code = params.get("code");
  if (!flow || !code || !sameState(params.get("state"), flow.state)) return to("expired");
  try {
    const tokens = await exchangeSheetsCode({ code, verifier: flow.verifier, clientId: config.google.clientId, clientSecret: config.google.clientSecret, redirectUri: `${origin}/api/sheets/google/callback` });
    const db = getWorkspaceDb(user.workspaceId);
    saveRefreshToken(db, tokens.refreshToken, config.sessionSecret);
    logActivity(db, user.email, "sheets.connected");
  } catch { return to("failed"); }
  return to("connected");
}
