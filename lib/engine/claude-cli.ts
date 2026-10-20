import { spawn } from "node:child_process";
import type { AiEngine } from "./types";

/** Uses the `claude` command already signed in on this computer (your subscription). No tools, no memory. */
export class ClaudeCliEngine implements AiEngine {
  constructor(private readonly opts: { command?: string; model?: string } = {}) {}

  complete({ system, prompt, timeoutMs = 120_000 }: { system: string; prompt: string; timeoutMs?: number }): Promise<string> {
    const args = ["-p", "--tools", "", "--no-session-persistence", "--disable-slash-commands", "--output-format", "text", "--system-prompt", system];
    if (this.opts.model) args.push("--model", this.opts.model);
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.command ?? "claude", args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("AI timed out")); }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) resolve(out.trim());
        else reject(new Error(`AI failed (exit ${code}): ${(err || out).slice(0, 300)}`));
      });
      child.stdin.end(prompt);
    });
  }
}
