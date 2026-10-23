import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "../proxy";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : undefined });
}

describe("auth proxy", () => {
  it.each(["/login", "/setup"])("allows the public route %s", (path) => {
    expect(proxy(request(path))).toBeInstanceOf(NextResponse);
    expect(proxy(request(path))?.status).toBe(200);
  });

  it.each(["/login-evil", "/setupanything"])("does not treat prefixed route %s as public", (path) => {
    const response = proxy(request(path));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows the signed webhook without a user session", () => {
    expect(proxy(request("/api/billing/webhook"))?.status).toBe(200);
  });

  it("redirects a protected route without a session", () => {
    expect(proxy(request("/settings"))?.headers.get("location")).toBe("http://localhost/login");
  });
});
