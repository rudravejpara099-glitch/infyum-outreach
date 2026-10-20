// Run with: npm run backup. Makes a safe copy of the database (works while the app and worker run).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";

const dir = join(process.cwd(), "data", "backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `outreach-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
openDb(config.dbPath).backup(file).then(() => console.log(`Backup saved: ${file}`));
