import path from "node:path";

// All environment-dependent settings live here, nowhere else.
export const config = {
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), "data", "outreach.db"),
  /** Browser profiles for connected Instagram accounts, one folder each. */
  profilesDir: process.env.PROFILES_DIR ?? path.join(process.cwd(), "data", "profiles"),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-change-me-dev-only-change-me",
  sessionDays: 14,
  defaultCountry: "United States",
  /** Hard stop: the worker never sends more than this per run, whatever the settings say. */
  absoluteDailyCeiling: 60,
};
