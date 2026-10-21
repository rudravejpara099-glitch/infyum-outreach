import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openDb } from "@/lib/db/core";
import { createFirstUser } from "@/lib/auth/first-user";
const run = promisify(execFile);
let directory: string | undefined;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });
it("creates the first workspace user only once", () => {
  const db = openDb(":memory:");
  try {
    expect(createFirstUser(db, { email: "first@example.test", name: "First", passwordHash: "fixture-hash" })?.email).toBe("first@example.test");
    expect(createFirstUser(db, { email: "second@example.test", name: "Second", passwordHash: "fixture-hash" })).toBeNull();
    expect((db.prepare("SELECT count(*) n FROM users").get() as { n: number }).n).toBe(1);
  } finally { db.close(); }
});
it("lets only one of two independent setup processes create a workspace user", async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "outreach-first-user-"));
  const filename = path.join(directory, "fixture.db"), db = openDb(filename); db.close();
  const results = await Promise.all(["one@example.test", "two@example.test"].map(email => run(process.execPath, ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), path.resolve("tests/helpers/first-user.ts"), filename, email], { env: { ...process.env, NODE_ENV: "test" }, timeout: 10000 })));
  expect(results.map(result => JSON.parse(result.stdout).created).sort()).toEqual([false, true]);
  const check = openDb(filename);
  try { expect((check.prepare("SELECT count(*) n FROM users").get() as { n: number }).n).toBe(1); } finally { check.close(); }
});
