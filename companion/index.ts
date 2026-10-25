import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ChromeInstagram } from "../worker/chrome-read-only";
import { CredentialFile } from "./connection";
import { ConnectorRuntime } from "./runtime";
import { startLocalServer } from "./local-server";

async function main() {
  const dataDirectory = process.env.OUTREACH_CONNECTOR_DATA_DIR ?? join(homedir(), "Library", "Application Support", "Outreach Connector");
  const credentials = new CredentialFile(join(dataDirectory, "device.json"));
  const driver = new ChromeInstagram();
  const runtime = new ConnectorRuntime(driver, fetch, Date.now, undefined, value => value ? credentials.save(value) : credentials.clear());
  const saved = credentials.load();
  if (saved) runtime.restore(saved);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true; runtime.stop(); clearInterval(timer);
    await Promise.allSettled([driver.close(), local.close()]);
    process.exit(0);
  };
  const local = await startLocalServer(runtime, { onQuit: () => { void stop(); } });
  // The URL contains no token or credential. The local page requires same-origin requests plus its private CSRF token.
  if (process.platform === "darwin" && process.env.OUTREACH_CONNECTOR_NO_OPEN !== "1") spawn("/usr/bin/open", [local.url], { stdio: "ignore" }).unref();
  console.info(`Open ${local.url} to connect Outreach.`);
  const timer = setInterval(() => { void runtime.tick(); }, 1_000);
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
}
void main().catch(() => { console.error("Outreach Connector could not start. Reopen it and try again."); process.exitCode = 1; });
