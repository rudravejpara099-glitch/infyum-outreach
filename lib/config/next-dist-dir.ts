const smokeDistDirPattern = /^\.next-smoke-[a-z0-9-]{1,64}$/;
const smokeTsconfigPattern = /^\.tsconfig-smoke-[a-z0-9-]{1,64}\.json$/;

export function nextDistDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const smokeDistDir = env.OUTREACH_SMOKE_DIST_DIR;
  if (!smokeDistDir) return ".next";
  if (!smokeDistDirPattern.test(smokeDistDir)) {
    throw new Error("OUTREACH_SMOKE_DIST_DIR must be a dedicated .next-smoke-* directory inside the app.");
  }
  return smokeDistDir;
}

export function nextTsconfigPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const smokeTsconfig = env.OUTREACH_SMOKE_TSCONFIG;
  if (!smokeTsconfig) return "tsconfig.json";
  if (!smokeTsconfigPattern.test(smokeTsconfig)) {
    throw new Error("OUTREACH_SMOKE_TSCONFIG must be a dedicated .tsconfig-smoke-*.json file inside the app.");
  }
  return smokeTsconfig;
}
