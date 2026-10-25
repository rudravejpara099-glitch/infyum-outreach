/** Offline packaging only: installed dependencies and this machine's Node binary. */
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { verifyPackagedConnector } from "../companion/package-smoke";

function packageDirectory(entry: string, name: string): string {
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    try { if (JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name === name) return directory; } catch { /* Keep walking to package root. */ }
    directory = dirname(directory);
  }
  throw new Error(`Installed package ${name} could not be located.`);
}
async function main() {
  if (process.platform !== "darwin") throw new Error("Build the Mac connector on macOS.");
  const output = resolve("data/connector-dist");
  const appName = `Outreach Connector-${process.arch}.app`;
  const app = join(output, appName), resources = join(app, "Contents", "Resources");
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  await build({ entryPoints: ["companion/index.ts"], outfile: join(resources, "connector.mjs"), bundle: true, platform: "node", target: "node22", format: "esm", external: ["chrome-devtools-mcp"], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
  const visited = new Map<string, string>();
  function copyPackage(name: string, from: string, destinationModules: string): void {
    const resolver = createRequire(join(from, "package.json"));
    const source = realpathSync(packageDirectory(resolver.resolve(name), name));
    const destination = join(destinationModules, name);
    if (visited.get(source) === destination) return;
    visited.set(source, destination);
    cpSync(source, destination, { recursive: true, dereference: true, filter: path => !path.includes(`${source}/node_modules/`) && path !== `${source}/node_modules` });
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    for (const dependency of Object.keys(manifest.dependencies ?? {})) copyPackage(dependency, source, join(destination, "node_modules"));
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) { try { copyPackage(dependency, source, join(destination, "node_modules")); } catch { /* Optional, not installed on this architecture. */ } }
  }
  copyPackage("chrome-devtools-mcp", process.cwd(), join(resources, "node_modules"));
  cpSync(process.execPath, join(resources, "node"));
  chmodSync(join(resources, "node"), 0o755);
  const launcher = join(app, "Contents", "MacOS", "Outreach Connector");
  writeFileSync(launcher, '#!/bin/sh\nset -eu\nRESOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)"\nexec "$RESOURCE_DIR/node" "$RESOURCE_DIR/connector.mjs"\n', { mode: 0o755 });
  writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Outreach Connector</string><key>CFBundleIdentifier</key><string>com.outreach.connector</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleExecutable</key><string>Outreach Connector</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
  writeFileSync(join(output, "INSTALL.txt"), `Outreach Connector for macOS ${process.arch}\n\nMove the app to Applications and open it. Paste the one-time code from your Outreach Accounts page. Keep the connector and your signed-in Chrome open while campaigns run. In Chrome open chrome://inspect/#remote-debugging, enable remote debugging, and allow the connection prompt when shown.\n\nThis local build is unsigned and not notarized. macOS may block opening downloaded copies. A signed/notarized distribution and an independent customer-machine check are still required for a public release.\n\nPasswords/cookies stay in Chrome. Only this workspace's operations and their results go to the website you approve. Disconnect in the connector or revoke the device in Outreach.\n`);
  const archive = join(output, `Outreach-Connector-macOS-${process.arch}.zip`);
  rmSync(archive, { force: true });
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
  execFileSync("/usr/bin/zip", ["-q", "-j", archive, join(output, "INSTALL.txt")]);
  if (process.argv.includes("--verify")) {
    await verifyPackagedConnector(launcher, join(output, "screenshots"));
    console.info("Packaged executable smoke passed: startup, local permission preview, unauthorized-request rejection and clean quit. No Chrome connection or pairing request.");
  }
  console.info(`Built ${archive}. Unsigned local build; independent installation remains unverified.`);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Connector packaging failed."); process.exitCode = 1; });
