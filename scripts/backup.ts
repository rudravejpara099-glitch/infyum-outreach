// Run with npm run backup. The source stays read-only, including before new migrations.
import { join } from "node:path";
import { config } from "@/lib/config";
import { backupDatabase } from "@/lib/backup";
void backupDatabase(config.dbPath, join(process.cwd(), "data", "backups"))
  .then(file => console.log(`Backup saved: ${file}`))
  .catch(() => { console.error("Backup could not complete. Check the saved database location and try again."); process.exitCode = 1; });
