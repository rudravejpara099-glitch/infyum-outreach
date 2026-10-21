import { execFile } from "node:child_process";

export type ClaudeLoginState = "signed_in" | "signed_out" | "unavailable" | "unknown";

export function parseClaudeLoginState(output: string): ClaudeLoginState {
  try {
    const status: unknown = JSON.parse(output);
    if (!status || typeof status !== "object" || !("loggedIn" in status)) return "unknown";
    if (status.loggedIn === true) return "signed_in";
    if (status.loggedIn === false) return "signed_out";
    return "unknown";
  } catch {
    return "unknown";
  }
}

type ReadStatus = () => Promise<string>;

function readStatusCommand(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("claude", ["auth", "status", "--json"], { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096 }, (error, stdout) => {
      if (stdout) resolve(stdout);
      else if (error) reject(error);
      else resolve("");
    });
  });
}

export async function claudeLoginState(readStatus: ReadStatus = readStatusCommand): Promise<ClaudeLoginState> {
  try {
    return parseClaudeLoginState(await readStatus());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unavailable";
    return "unknown";
  }
}
