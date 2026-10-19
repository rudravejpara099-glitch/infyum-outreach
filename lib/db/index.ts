import "server-only";
import { config } from "@/lib/config";
import { openDb, type Db } from "./core";

export type { Db };

// One connection per process. In dev, hot reload would open a new one on every edit, so cache it.
const g = globalThis as unknown as { __db?: Db };
export function getDb(): Db {
  return (g.__db ??= openDb(config.dbPath));
}
