import { NextResponse, type NextRequest } from "next/server";

// Quick, optimistic redirect only. The real check is requireUser() in lib/auth/dal.ts.
const PUBLIC = new Set(["/login", "/setup", "/register", "/join"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Stripe authenticates its raw-body webhook by signature, not a user cookie.
  if (new Set(["/api/connector/pair", "/api/connector/poll", "/api/connector/result", "/api/connector/callback", "/api/connector/kill"]).has(pathname)) return NextResponse.next();
  // Google sends people back here before they have a session; both routes check everything themselves.
  if (pathname === "/api/auth/google/start" || pathname === "/api/auth/google/callback") return NextResponse.next();
  if (pathname === "/api/billing/webhook") return NextResponse.next();
  if (PUBLIC.has(pathname)) return NextResponse.next();
  if (!req.cookies.get("session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
