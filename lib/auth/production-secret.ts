export const DEFAULT_SESSION_SECRET = "dev-only-change-me-dev-only-change-me";
const placeholders = new Set([DEFAULT_SESSION_SECRET, "change-me-to-a-long-random-string"]);

/** Production must never sign sessions with a missing or publicly known key. */
export function assertProductionSecret(secret: string | undefined): void {
  if (!secret || secret.trim().length < 32 || placeholders.has(secret.trim())) {
    throw new Error("Set SESSION_SECRET to at least 32 random characters before starting production.");
  }
}
