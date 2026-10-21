import { NextResponse, type NextRequest } from "next/server";

// Quick, optimistic redirect only. The real check is requireUser() in lib/auth/dal.ts.
const PUBLIC = ["/login", "/setup"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Stripe authenticates its raw-body webhook by signature, not a user cookie.
  if (pathname === "/api/billing/webhook") return NextResponse.next();
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
