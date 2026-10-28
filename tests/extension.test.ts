import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the extension's page script in step with the worker's profile script", () => {
  const files = ["extension/page-scripts.js", "extension/warmup.js"];
  const before = files.map((file) => readFileSync(file, "utf8"));
  execFileSync("npx", ["tsx", "scripts/build-extension.ts"], { stdio: "ignore" });
  expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(before);
}, 30_000);

it("declares a Manifest V3 extension that can poll in the background", () => {
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(expect.arrayContaining(["alarms", "storage", "scripting", "tabs", "debugger"]));
  expect(manifest.background.service_worker).toBe("background.js");
});

it("hands the warm-up page scripts their targets as parameters, with no sample values left", () => {
  const pages = readFileSync("extension/page-scripts.js", "utf8");
  expect(pages).toContain("warmupInPage = (argPaths, argOwner, argComment) =>");
  expect(pages).toContain("storyLikeInPage = (argStory) =>");
  expect(pages).not.toMatch(/sentinel/i);
});

it("bundles the shared warm-up logic and keeps the stop checks in the action code", () => {
  const warm = readFileSync("extension/warmup.js", "utf8");
  expect(warm).toContain("runChromeWarmup");
  expect(warm).toContain("Campaign preparation was stopped.");
  const actions = readFileSync("extension/actions.js", "utf8");
  expect(actions).toContain("gate.mayContinue");
});
