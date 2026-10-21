import path from "node:path";

export function loginWindowCommand(accountId: number, jobId: number, cwd = process.cwd()) {
  if (!Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(jobId) || jobId < 1) throw new Error("A valid account and sign-in request are required");
  return {
    command: process.execPath,
    args: ["--import", "tsx", path.join(cwd, "scripts", "open-instagram-login.ts"), String(accountId), String(jobId)],
  };
}
