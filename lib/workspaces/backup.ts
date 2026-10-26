import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { backupDatabase } from "@/lib/backup";

/** Copy the catalog first, then every database referenced by that snapshot. */
export async function backupWorkspaceSet(source: string, destination: string): Promise<string> {
  const directory = path.join(destination, `workspaces-${randomUUID()}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const records: { workspaceId: string; file: string }[] = [];
  const catalogSource = `${source}.identity.db`;
  let catalogFile: string | undefined;
  if (existsSync(catalogSource)) {
    catalogFile = await backupDatabase(catalogSource, directory);
    const snapshot = new Database(catalogFile, { readonly: true, fileMustExist: true });
    try {
      const workspaces = snapshot.prepare("SELECT id FROM workspace_catalog WHERE legacy=0").all() as { id: string }[];
      for (const { id } of workspaces) {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error("Invalid workspace in backup catalog.");
        const file = path.join(path.dirname(source), "workspaces", id, "outreach.db");
        // A just-created company may not have opened its empty database yet.
        if (existsSync(file)) records.push({ workspaceId: id, file: path.basename(await backupDatabase(file, directory)) });
      }
    } finally { snapshot.close(); }
  }
  records.unshift({ workspaceId: "legacy", file: path.basename(await backupDatabase(source, directory)) });
  const manifest = path.join(directory, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), catalog: catalogFile ? path.basename(catalogFile) : null, workspaces: records, browserProfilesIncluded: false }, null, 2), { mode: 0o600 });
  return manifest;
}
