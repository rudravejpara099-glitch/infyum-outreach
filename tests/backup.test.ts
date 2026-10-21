import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { backupDatabase } from "@/lib/backup";
let directory: string;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  directory = mkdtempSync(path.join(os.tmpdir(), "outreach-backup-"));
  const filename = path.join(directory, "source.db"), db = new Database(filename);
  db.pragma("journal_mode=WAL"); db.exec("CREATE TABLE payload(value TEXT); INSERT INTO payload VALUES('committed'); PRAGMA user_version=7");
  return { db, filename, destination: path.join(directory, "backups") };
}
it("backs up committed WAL data without running app migrations or changing the source schema", async () => {
  const { db, filename, destination } = fixture();
  try {
    db.exec("BEGIN IMMEDIATE; INSERT INTO payload VALUES('not committed')");
    const copy = await backupDatabase(filename, destination), snapshot = new Database(copy, { readonly: true });
    try {
      expect(snapshot.prepare("SELECT value FROM payload").all()).toEqual([{ value: "committed" }]);
      expect(snapshot.pragma("user_version", { simple: true })).toBe(7);
      expect(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()).toBeUndefined();
    } finally { snapshot.close(); }
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()).toBeUndefined();
    expect(statSync(copy).mode & 0o777).toBe(0o600);
    expect(readdirSync(destination).some(name => name.endsWith(".partial"))).toBe(false);
  } finally { if (db.inTransaction) db.exec("ROLLBACK"); db.close(); }
});
it("creates distinct completed backup files for concurrent requests", async () => {
  const { db, filename, destination } = fixture();
  try {
    const files = await Promise.all([backupDatabase(filename, destination), backupDatabase(filename, destination)]);
    expect(new Set(files).size).toBe(2); expect(files.every(existsSync)).toBe(true);
  } finally { db.close(); }
});
it("refuses a missing source without creating a fresh empty database", async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "outreach-backup-missing-"));
  const missing = path.join(directory, "missing.db");
  await expect(backupDatabase(missing, path.join(directory, "backups"))).rejects.toThrow();
  expect(existsSync(missing)).toBe(false);
});

it("the actual backup command copies an explicit fixture database without migrating it", async () => {
  const { db, filename } = fixture();
  try {
    const result = await promisify(execFile)(process.execPath, ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), path.resolve("scripts/backup.ts")], { cwd: directory, env: { ...process.env, NODE_ENV: "test", DB_PATH: filename, TSX_TSCONFIG_PATH: path.resolve("tsconfig.json") }, timeout: 10000 });
    expect(result.stdout.startsWith("Backup saved: ")).toBe(true);
    const copied = result.stdout.trim().slice("Backup saved: ".length);
    expect(copied.startsWith(path.join(realpathSync(directory), "data", "backups") + path.sep)).toBe(true);
    const snapshot = new Database(copied, { readonly: true });
    try { expect(snapshot.prepare("SELECT value FROM payload").all()).toEqual([{ value: "committed" }]); } finally { snapshot.close(); }
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()).toBeUndefined();
  } finally { db.close(); }
});
