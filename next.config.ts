import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Live internal data stays uncached; keep the native SQLite module external.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
