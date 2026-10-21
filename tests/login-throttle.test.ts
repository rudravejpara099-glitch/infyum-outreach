import { afterEach, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { openDb, type Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { consumeLoginAttempt, clearLoginAttempts, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS, LOGIN_ATTEMPTS_KEY } from "@/lib/auth/login-throttle";
let db: Db;
const now = Date.parse("2026-10-21T12:00:00Z");
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());
it("reserves five attempts atomically, then blocks more work in the window", () => {
  for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) expect(consumeLoginAttempt(db, "one@example.test", now).allowed).toBe(true);
  expect(consumeLoginAttempt(db, "one@example.test", now)).toMatchObject({ allowed: false, retryAfterSeconds: LOGIN_WINDOW_MS / 1000 });
});
it("normalizes identity so case and whitespace cannot bypass the counter", () => {
  for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) consumeLoginAttempt(db, " One@Example.Test ", now);
  expect(consumeLoginAttempt(db, "one@example.test", now + 1).allowed).toBe(false);
  expect(consumeLoginAttempt(db, "other@example.test", now + 1).allowed).toBe(true);
});
it("expires the window at its exact boundary and resets after a valid sign-in", () => {
  for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) consumeLoginAttempt(db, "one@example.test", now);
  expect(consumeLoginAttempt(db, "one@example.test", now + LOGIN_WINDOW_MS - 1).allowed).toBe(false);
  expect(consumeLoginAttempt(db, "one@example.test", now + LOGIN_WINDOW_MS).allowed).toBe(true);
  clearLoginAttempts(db, "one@example.test", now + LOGIN_WINDOW_MS);
  for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) expect(consumeLoginAttempt(db, "one@example.test", now + LOGIN_WINDOW_MS).allowed).toBe(true);
});
it("persists only hashed identifiers and counts, never raw email or password data", () => {
  consumeLoginAttempt(db, "one@example.test", now);
  const raw = getSetting(db, LOGIN_ATTEMPTS_KEY)!;
  expect(raw).not.toContain("one@example.test");
  expect(Object.keys(JSON.parse(raw))[0]).toBe(createHash("sha256").update("one@example.test").digest("hex"));
});
it("bounds active records and frees old entries without permanently locking new users", () => {
  const full = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [createHash("sha256").update(`${index}@example.test`).digest("hex"), { startedAt: now, attempts: 1 }]));
  setSetting(db, LOGIN_ATTEMPTS_KEY, JSON.stringify(full));
  expect(consumeLoginAttempt(db, "new@example.test", now).allowed).toBe(false);
  expect(consumeLoginAttempt(db, "0@example.test", now).allowed).toBe(true);
  expect(consumeLoginAttempt(db, "new@example.test", now + LOGIN_WINDOW_MS).allowed).toBe(true);
  expect(Object.keys(JSON.parse(getSetting(db, LOGIN_ATTEMPTS_KEY)!))).toHaveLength(1);
});
it("handles malformed stored state without exposing it to the caller", () => {
  setSetting(db, LOGIN_ATTEMPTS_KEY, "invalid json");
  expect(consumeLoginAttempt(db, "one@example.test", now).allowed).toBe(true);
});
