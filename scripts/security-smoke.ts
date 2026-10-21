/** Production-start checks against disposable data. No worker/provider is started. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SESSION_SECRET } from "@/lib/auth/production-secret";
const temp = mkdtempSync(path.join(os.tmpdir(), "outreach-production-"));
const port = 3193, base = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited; clearTimeout(timer);
}
async function main() {
  try {
    for (const [index, secret] of ["", DEFAULT_SESSION_SECRET].entries()) {
      let output = "";
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "production", SESSION_SECRET: secret, DB_PATH: path.join(temp, `unsafe-${index}.db`), PROFILES_DIR: path.join(temp, "profiles"), APIFY_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
      server.stdout?.on("data", data => { output += String(data); }); server.stderr?.on("data", data => { output += String(data); });
      const code = await new Promise<number | null>(resolve => {
        const timer = setTimeout(() => { server?.kill("SIGTERM"); resolve(null); }, 10000);
        server!.once("exit", value => { clearTimeout(timer); resolve(value); });
      });
      assert(code !== null && code !== 0, "Production accepted an unsafe secret or did not terminate");
      assert(output.includes("Set SESSION_SECRET to at least 32 random characters"), "Production must explain the missing/default secret without echoing it");
      await stop(server);
    }
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "production", SESSION_SECRET: randomBytes(48).toString("hex"), DB_PATH: path.join(temp, "configured.db"), PROFILES_DIR: path.join(temp, "profiles"), APIFY_TOKEN: "" }, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode !== null) break;
      try { const response = await fetch(`${base}/setup`); if (response.ok && (await response.text()).includes("<form")) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready, "Configured production server could not serve its temporary setup page");
    console.log("Security startup smoke passed: blank/default production secrets refused; an explicitly configured secret serves an isolated app. No worker, paid provider or outreach.");
  } finally { if (server) await stop(server); rmSync(temp, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
