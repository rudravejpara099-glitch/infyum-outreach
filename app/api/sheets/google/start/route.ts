import { NextResponse } from "next/server";
import { FLOW_SECONDS, newFlow, sealFlow } from "@/lib/auth/google";
import { appOrigin, googleEnabled, sessionKey } from "@/lib/auth/google-config";
import { requireUser } from "@/lib/auth/dal";
import { config } from "@/lib/config";
import { SHEETS_FLOW_COOKIE, sheetsAuthorizationUrl } from "@/lib/sheets/oauth";
export const runtime = "nodejs";

/** Sends a signed-in person to Google to let this workspace use Google Sheets. */
export async function GET(request: Request) {
  await requireUser();
  const origin = appOrigin(request);
  const back = (code: string) => NextResponse.redirect(new URL(`/settings?sheets=${code}`, origin));
  if (!googleEnabled()) return back("off");
  const flow = newFlow("link");
  const response = NextResponse.redirect(sheetsAuthorizationUrl({ clientId: config.google.clientId, redirectUri: `${origin}/api/sheets/google/callback`, flow }));
  response.cookies.set(SHEETS_FLOW_COOKIE, await sealFlow(flow, sessionKey()), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/sheets/google", maxAge: FLOW_SECONDS });
  return response;
}
