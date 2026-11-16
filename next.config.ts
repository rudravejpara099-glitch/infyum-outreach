import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { nextDistDir, nextTsconfigPath } from "./lib/config/next-dist-dir";
import { assertProductionSecret } from "./lib/auth/production-secret";
import { securityHeaders } from "./lib/config/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "production") }];
  },
  // Live internal data stays uncached; keep the native SQLite module external.
  serverExternalPackages: ["better-sqlite3"],
  distDir: nextDistDir(),
  typescript: { tsconfigPath: nextTsconfigPath() },
  turbopack: { root: path.resolve(process.cwd()) },
  // The public address (Vercel front door) reaches this app through a tunnel; allow its form posts.
  // Exact address only: a wildcard such as *.trycloudflare.com would let anyone's tunnel post to this app's
  // server actions. When a tunnel is switched back on, add its exact host here (a named tunnel keeps it stable).
  experimental: { serverActions: { allowedOrigins: ["infyum-outreach.vercel.app"] } },
};

export default function configuration(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) assertProductionSecret(process.env.SESSION_SECRET);
  return nextConfig;
}
