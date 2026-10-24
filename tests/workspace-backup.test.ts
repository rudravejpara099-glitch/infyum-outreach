import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { openDb } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import { createWorkspace, ensureLegacyWorkspace } from "@/lib/workspaces/catalog";
import { backupWorkspaceSet } from "@/lib/workspaces/backup";

let directory: string;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
it("backs up the identity catalog and every opened company with a private restore manifest", async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "workspace-backup-"));
  const source = path.join(directory, "original.db"), original = openDb(source), identity = openDb(`${source}.identity.db`);
  const user = createUser(original, "owner@example.test", "Owner", "private-hash");
  ensureLegacyWorkspace(identity, original);
  const company = createWorkspace(identity, user.id, "Private company");
  createWorkspace(identity, user.id, "Not opened yet");
  const companyDir = path.join(directory, "workspaces", company.id);
  mkdirSync(companyDir, { recursive: true });
  const operational = openDb(path.join(companyDir, "outreach.db"));
  operational.exec("INSERT INTO campaigns(name) VALUES ('Private campaign')");
  try {
    const manifestPath = await backupWorkspaceSet(source, path.join(directory, "backups"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { catalog: string; workspaces: { workspaceId: string; file: string }[]; browserProfilesIncluded: boolean };
    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(manifestPath)).mode & 0o777).toBe(0o700);
    expect(manifest.browserProfilesIncluded).toBe(false);
    expect(manifest.workspaces.map(row => row.workspaceId)).toEqual(["legacy", company.id]);
    const catalogCopy = new Database(path.join(path.dirname(manifestPath), manifest.catalog), { readonly: true });
    try { expect(catalogCopy.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id)).toEqual({ password_hash: "private-hash" }); }
    finally { catalogCopy.close(); }
    const file = manifest.workspaces.find(row => row.workspaceId === company.id)!.file;
    const companyCopy = new Database(path.join(path.dirname(manifestPath), file), { readonly: true });
    try { expect(companyCopy.prepare("SELECT name FROM campaigns").all()).toEqual([{ name: "Private campaign" }]); }
    finally { companyCopy.close(); }
  } finally { operational.close(); identity.close(); original.close(); }
});
it("refuses unsafe catalog paths without producing a complete manifest", async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "workspace-backup-"));
  const source = path.join(directory, "original.db"), original = openDb(source), identity = openDb(`${source}.identity.db`);
  ensureLegacyWorkspace(identity, original);
  identity.prepare("INSERT INTO workspace_catalog(id,name) VALUES ('../outside','Invalid')").run();
  try { await expect(backupWorkspaceSet(source, path.join(directory, "backups"))).rejects.toThrow("Invalid workspace"); }
  finally { identity.close(); original.close(); }
});
