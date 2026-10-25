import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DeviceCredential = { origin: string; token: string; device: { id: string; workspaceId: string; userId: number; label: string; lastSeen: number } };
export function serverOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw new Error("Use the website address from your Outreach connection code.");
  }
  return url.origin;
}
export function parseConnectionCode(value: string): { origin: string; code: string } {
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(value.trim())) throw new Error("Paste the complete connection code from Outreach.");
  const parsed = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof parsed.origin !== "string" || typeof parsed.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.code)) throw new Error("This connection code is invalid.");
  return { origin: serverOrigin(parsed.origin), code: parsed.code };
}
export class CredentialFile {
  constructor(private readonly path: string) {}
  load(): DeviceCredential | null {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as DeviceCredential;
      serverOrigin(value.origin);
      if (typeof value.token !== "string" || !value.token || typeof value.device?.id !== "string") return null;
      chmodSync(this.path, 0o600);
      return value;
    } catch { return null; }
  }
  save(value: DeviceCredential): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.path), 0o700);
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
  }
  clear(): void { rmSync(this.path, { force: true }); }
}
