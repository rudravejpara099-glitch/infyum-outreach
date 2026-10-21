import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { assertProductionSecret } from "./lib/auth/production-secret";

const nextConfig: NextConfig = {
  // Live internal data stays uncached; keep the native SQLite module external.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: path.resolve(process.cwd()) },
};

export default function configuration(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) assertProductionSecret(process.env.SESSION_SECRET);
  return nextConfig;
}
