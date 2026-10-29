import { NextResponse } from "next/server";
import { authorizationUrl, FLOW_COOKIE, FLOW_SECONDS, newFlow, sealFlow } from "@/lib/auth/google";
import { appOrigin, googleEnabled, redirectUri, sessionKey } from "@/lib/auth/google-config";
import { readSession } from "@/lib/auth/session";
import { config } from "@/lib/config";
export const runtime = "nodejs";

/** Public on purpose: it only sends the browser to Google. Connecting an account (intent=link) needs a signed-in session. */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const intent = new URL(request.url).searchParams.get("intent") === "link" ? "link" : "login";
  const back = (code: string) => NextResponse.redirect(new URL(`${intent === "link" ? "/settings" : "/login"}?google=${code}`, origin));
  if (!googleEnabled()) return back("off");
  if (intent === "link" && !(await readSession())) return NextResponse.redirect(new URL("/login", origin));
  const flow = newFlow(intent);
  const response = NextResponse.redirect(authorizationUrl({ clientId: config.google.clientId, redirectUri: redirectUri(origin), flow }));
  response.cookies.set(FLOW_COOKIE, await sealFlow(flow, sessionKey()), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/auth/google", maxAge: FLOW_SECONDS });
  return response;
}
