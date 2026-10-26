import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPTS_KEY = "auth_login_attempts";
const MAX_ACTIVE_KEYS = 1000;
type Window = { startedAt: number; attempts: number };
type Windows = Record<string, Window>;
const identity = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
function activeWindows(db: Db, now: number): Windows {
  let saved: unknown;
  try { saved = JSON.parse(getSetting(db, LOGIN_ATTEMPTS_KEY) ?? "{}"); } catch { saved = {}; }
  const active: Windows = Object.create(null);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return active;
  for (const [key, value] of Object.entries(saved)) {
    const window = value as Partial<Window> | null;
    if (!/^[a-f0-9]{64}$/.test(key) || !window || !Number.isSafeInteger(window.startedAt) || !Number.isSafeInteger(window.attempts)) continue;
    const { startedAt, attempts } = window as Window;
    if (startedAt <= now && now - startedAt < LOGIN_WINDOW_MS && attempts >= 0 && attempts <= MAX_LOGIN_ATTEMPTS) active[key] = { startedAt, attempts };
  }
  return active;
}
const secondsRemaining = (start: number, now: number) => Math.max(1, Math.ceil((start + LOGIN_WINDOW_MS - now) / 1000));

/** Reserve before password verification so concurrent requests cannot all pass the check. */
export function consumeLoginAttempt(db: Db, email: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  return db.transaction(() => {
    const windows = activeWindows(db, now), key = identity(email), prior = windows[key];
    if (prior?.attempts === MAX_LOGIN_ATTEMPTS) return { allowed: false, retryAfterSeconds: secondsRemaining(prior.startedAt, now) };
    if (!prior && Object.keys(windows).length >= MAX_ACTIVE_KEYS) {
      const oldest = Math.min(...Object.values(windows).map(window => window.startedAt));
      return { allowed: false, retryAfterSeconds: secondsRemaining(oldest, now) };
    }
    windows[key] = { startedAt: prior?.startedAt ?? now, attempts: (prior?.attempts ?? 0) + 1 };
    setSetting(db, LOGIN_ATTEMPTS_KEY, JSON.stringify(windows));
    return { allowed: true, retryAfterSeconds: 0 };
  }).immediate();
}
export function clearLoginAttempts(db: Db, email: string, now = Date.now()): void {
  db.transaction(() => {
    const windows = activeWindows(db, now); delete windows[identity(email)];
    setSetting(db, LOGIN_ATTEMPTS_KEY, JSON.stringify(windows));
  }).immediate();
}
