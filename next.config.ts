import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { nextDistDir, nextTsconfigPath } from "./lib/config/next-dist-dir";
import { assertProductionSecret } from "./lib/auth/production-secret";

const nextConfig: NextConfig = {
  // Live internal data stays uncached; keep the native SQLite module external.
  serverExternalPackages: ["better-sqlite3"],
  distDir: nextDistDir(),
  typescript: { tsconfigPath: nextTsconfigPath() },
  turbopack: { root: path.resolve(process.cwd()) },
  // The public address (Vercel front door) reaches this app through a tunnel; allow its form posts.
  experimental: { serverActions: { allowedOrigins: ["infyum-outreach.vercel.app", "*.trycloudflare.com"] } },
};

export default function configuration(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) assertProductionSecret(process.env.SESSION_SECRET);
  return nextConfig;
}
