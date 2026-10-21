import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const configPath = path.resolve("lib/config.ts"), loader = path.resolve("node_modules/tsx/dist/loader.mjs");
let directory: string;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
function readConfig(overrides: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of ["DB_PATH", "PROFILES_DIR", "SESSION_SECRET", "APIFY_TOKEN", "__NEXT_PROCESSED_ENV"]) delete env[key];
  Object.assign(env, { NODE_ENV: "development" }, overrides);
  return JSON.parse(execFileSync(process.execPath, ["--import", loader, "-e", `const {config}=require(${JSON.stringify(configPath)}); process.stdout.write(JSON.stringify({db:config.dbPath,profiles:config.profilesDir,sessionLoaded:config.sessionSecret==='fixture-session',providerLoaded:process.env.APIFY_TOKEN==='fixture-provider'}))`], { cwd: directory, env, encoding: "utf8", timeout: 10000 }));
}
function fixture() {
  directory = mkdtempSync(path.join(os.tmpdir(), "outreach-env-"));
  const db = path.join(directory, "configured.db"), profiles = path.join(directory, "profiles");
  writeFileSync(path.join(directory, ".env.local"), `DB_PATH=${db}\nPROFILES_DIR=${profiles}\nSESSION_SECRET=fixture-session\nAPIFY_TOKEN=fixture-provider\n`);
  return { db, profiles };
}
describe("shared configuration outside the Next runtime", () => {
  it("loads the saved database, browser profiles and provider settings before config is read", () => {
    const { db, profiles } = fixture();
    expect(readConfig()).toEqual({ db, profiles, sessionLoaded: true, providerLoaded: true });
  });
  it("keeps explicit process environment overrides ahead of saved local files", () => {
    fixture(); const db = path.join(directory, "explicit.db");
    expect(readConfig({ DB_PATH: db }).db).toBe(db);
  });
  it("ignores private local files in test mode and uses the test configuration", () => {
    fixture(); const db = path.join(directory, "only-test.db");
    writeFileSync(path.join(directory, ".env.test"), `DB_PATH=${db}\n`);
    expect(readConfig({ NODE_ENV: "test" })).toMatchObject({ db, sessionLoaded: false, providerLoaded: false });
  });
});
