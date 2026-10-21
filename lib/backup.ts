import Database from "better-sqlite3";
import { closeSync, mkdirSync, openSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Snapshot committed SQLite/WAL data without migrating or writing to the source. */
export async function backupDatabase(source: string, directory: string): Promise<string> {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  const filename = path.join(directory, `outreach-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.db`);
  const partial = filename + ".partial";
  let created = false;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    closeSync(openSync(partial, "wx", 0o600)); created = true;
    await db.backup(partial);
    renameSync(partial, filename);
    return filename;
  } catch (error) {
    if (created) rmSync(partial, { force: true });
    throw error;
  } finally { db.close(); }
}
