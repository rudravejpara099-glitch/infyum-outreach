import { describe, expect, it } from "vitest";
import configuration from "../next.config";
import { securityHeaders } from "../lib/config/security-headers";

const value = (headers: { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("stop the app being framed by another site", () => {
    const h = securityHeaders(false);
    expect(value(h, "X-Frame-Options")).toBe("DENY");
    expect(value(h, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("stop type sniffing, referrer leaks and device permission prompts", () => {
    const h = securityHeaders(false);
    expect(value(h, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(h, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value(h, "Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("never restrict form posts or navigation, so Google sign-in and Stripe redirects keep working", () => {
    const csp = value(securityHeaders(true), "Content-Security-Policy") ?? "";
    expect(csp).not.toMatch(/form-action|default-src|script-src|connect-src/);
  });

  it("send HSTS only in production, without subdomains", () => {
    expect(value(securityHeaders(false), "Strict-Transport-Security")).toBeUndefined();
    const hsts = value(securityHeaders(true), "Strict-Transport-Security");
    expect(hsts).toMatch(/^max-age=\d+$/);
    expect(Number(hsts?.split("=")[1])).toBeGreaterThanOrEqual(15552000);
  });

  it("are actually applied to every path by next.config", async () => {
    const config = configuration("phase-development-server");
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(value(rules[0].headers, "X-Frame-Options")).toBe("DENY");
  });
});
