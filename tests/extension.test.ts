import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the extension's page script in step with the worker's profile script", () => {
  const before = readFileSync("extension/page-scripts.js", "utf8");
  execFileSync("npx", ["tsx", "scripts/build-extension.ts"], { stdio: "ignore" });
  expect(readFileSync("extension/page-scripts.js", "utf8")).toBe(before);
}, 30_000);

it("declares a Manifest V3 extension that can poll in the background", () => {
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(expect.arrayContaining(["alarms", "storage", "scripting", "tabs"]));
  expect(manifest.background.service_worker).toBe("background.js");
});
