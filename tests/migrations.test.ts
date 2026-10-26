import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "@/lib/db/core";
import { migrations } from "@/lib/db/migrations";

describe("database migration upgrades", () => {
  it("upgrades an existing v1 database and safely reruns without duplicating changes", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
      db.exec(migrations[0].sql);
      db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)").run(migrations[0].id, migrations[0].name);

      migrate(db);

      expect(db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all()).toEqual(
        migrations.map(({ id, name }) => ({ id, name })),
      );
      expect(db.prepare("PRAGMA table_info(ig_accounts)").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "browser_mode" })]),
      );
      expect(db.prepare("SELECT count(*) AS count FROM billing_model_rates WHERE model='claude-sonnet-5-5'").get()).toEqual({ count: 1 });

      migrate(db);

      expect(db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all()).toEqual(
        migrations.map(({ id, name }) => ({ id, name })),
      );
      expect(db.prepare("SELECT count(*) AS count FROM billing_model_rates WHERE model='claude-sonnet-5-5'").get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});
