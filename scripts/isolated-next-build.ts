import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type IsolatedNextBuild = { distDir: string; tsconfigPath: string };

export function buildIsolatedNextApp(name: "ui" | "billing", secrets: string[] = []): IsolatedNextBuild {
  const reused = process.env.OUTREACH_REUSE_SMOKE_BUILD;
  if (reused) {
    if (!/^\.next-smoke-[a-z0-9-]{1,64}$/.test(reused) || !existsSync(path.join(reused, "BUILD_ID"))) throw new Error("Choose a completed isolated smoke build.");
    return { distDir: reused, tsconfigPath: `${reused.replace(".next-smoke-", ".tsconfig-smoke-")}.json` };
  }
  const suffix = randomBytes(4).toString("hex");
  const build = { distDir: `.next-smoke-${name}-${suffix}`, tsconfigPath: `.tsconfig-smoke-${name}-${suffix}.json` };
  writeFileSync(build.tsconfigPath, JSON.stringify({ extends: "./tsconfig.json" }));
  const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", OUTREACH_SMOKE_DIST_DIR: build.distDir, OUTREACH_SMOKE_TSCONFIG: build.tsconfigPath },
    encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-4000);
    const diagnostic = secrets.filter(Boolean).reduce((text, secret) => text.replaceAll(secret, "[redacted]"), output);
    cleanupIsolatedNextApp(build);
    throw new Error(`Isolated production build failed${diagnostic ? `:\n${diagnostic}` : ""}`, { cause: result.error });
  }
  return build;
}

export function cleanupIsolatedNextApp(build: IsolatedNextBuild): void {
  if (process.env.OUTREACH_REUSE_SMOKE_BUILD === build.distDir) return;
  rmSync(path.resolve(build.distDir), { recursive: true, force: true });
  rmSync(path.resolve(build.tsconfigPath), { force: true });
}
