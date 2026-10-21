import path from "node:path";
import { DEFAULT_SESSION_SECRET } from "./auth/production-secret";
import { loadEnvConfig } from "@next/env";

// CLI worker/backup/import processes need the same files and precedence as Next.
// The loader preserves explicit environment overrides and skips .env.local in tests.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

// All environment-dependent settings live here, nowhere else.
export const config = {
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), "data", "outreach.db"),
  /** Browser profiles for connected Instagram accounts, one folder each. */
  profilesDir: process.env.PROFILES_DIR ?? path.join(process.cwd(), "data", "profiles"),
  sessionSecret: process.env.SESSION_SECRET ?? DEFAULT_SESSION_SECRET,
  sessionDays: 14,
  defaultCountry: "United States",
  /** Hard stop: the worker never sends more than this per run, whatever the settings say. */
  absoluteDailyCeiling: 60,
};
