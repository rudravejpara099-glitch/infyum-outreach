import type { Db } from "@/lib/db/core";
import { getSetting } from "@/lib/db/repos/settings";
import type { IgAccount } from "@/lib/db/types";
import { createDeviceCommand, getDeviceCommand, respondDeviceCallback, cancelDeviceCommand } from "@/lib/connectors/commands";
import { InstagramBlockedError, InstagramSendUncertainError, InstagramWarmupUncertainError, type InstagramDriver, type ProfileFacts, type WarmUpResult } from "./driver";

type Kind = "openLogin" | "readFacts" | "readProfileNotes" | "readInbox" | "warmUp" | "sendMessages";
const jobs: Record<Kind, string[]> = { openLogin: ["open_login", "check_inbox"], readFacts: ["qualify"], readProfileNotes: ["draft_dm", "draft_followup"], readInbox: ["check_inbox"], warmUp: ["warmup"], sendMessages: ["send"] };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const handleValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._]{1,30}$/.test(value);
const boundedText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const invalid = () => new Error("The connected browser returned an invalid response. Reconnect it in Accounts.");

/** Only durable, account-bound commands cross the device connection. No browser secrets leave it. */
export class RemoteInstagramDriver implements InstagramDriver {
  constructor(private db: Db, private deviceId: string, private clock = () => Date.now(), private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  private online(): boolean {
    const seen = Number(getSetting(this.db, `device_seen_${this.deviceId}`));
    return Number.isSafeInteger(seen) && seen > 0 && seen <= this.clock() + 5000 && this.clock() - seen <= 30_000;
  }

  private async execute(account: IgAccount, kind: Kind, args: Record<string, unknown>, makeComment?: (context: string) => Promise<string>, mayContinue = () => true): Promise<unknown> {
    const allowedJobs = jobs[kind];
    const running = this.db.prepare(`SELECT id FROM jobs WHERE account_id=? AND status='running' AND type IN (${allowedJobs.map(() => "?").join(",")}) ORDER BY id LIMIT 2`).all(account.id, ...allowedJobs) as { id: number }[];
    if (running.length !== 1) throw new Error("The browser task must belong to one active account job.");
    if (!mayContinue()) throw new Error("Campaign preparation was stopped.");
    const write = kind === "warmUp" || kind === "sendMessages";
    const uncertain = (blocked = false, reason = "") => kind === "sendMessages" ? new InstagramSendUncertainError(blocked) : new InstagramWarmupUncertainError(blocked, reason);
    const existing = write ? this.db.prepare("SELECT id FROM device_commands WHERE job_id=? AND kind=? ORDER BY job_attempt DESC LIMIT 1").get(running[0].id, kind) as { id: string } | undefined : undefined;
    const previous = existing ? getDeviceCommand(this.db, existing.id) : null;
    if (!previous && !this.online()) throw new Error("Open Outreach Connector on your connected computer, then try again.");
    const command = previous ?? createDeviceCommand(this.db, { deviceId: this.deviceId, accountId: account.id, jobId: running[0].id, kind, args }, this.clock());
    if (command.deviceId !== this.deviceId || command.accountId !== account.id || JSON.stringify(command.args) !== JSON.stringify(args)) throw write ? uncertain() : invalid();
    const handledCallbacks = new Set<string>();
    while (true) {
      const current = getDeviceCommand(this.db, command.id);
      if (!current) throw write ? uncertain() : invalid();
      if (!mayContinue()) {
        cancelDeviceCommand(this.db, command.id, "Campaign preparation was stopped.", this.clock());
        throw write ? uncertain() : new Error("Campaign preparation was stopped.");
      }
      if (current.status === "done") return current.result;
      if (current.status === "failed" || current.status === "uncertain") {
        const blocked = /warning|human check|blocked by instagram/i.test(current.error ?? "");
        if (write) throw uncertain(blocked, (current.error ?? "").replace(/^.*Cause:\s*/, ""));
        if (blocked) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account on your connected device.");
        throw new Error(current.error || "The connected browser could not finish this task.");
      }
      if (!this.online()) {
        cancelDeviceCommand(this.db, command.id, "The connected computer went offline. Open Outreach Connector, then try again.", this.clock());
        if (write && current.status === "running") throw uncertain();
        throw new Error("Open Outreach Connector on your connected computer, then try again.");
      }
      if (this.clock() >= current.expiresAt) {
        cancelDeviceCommand(this.db, command.id, "The connected browser did not finish in time.", this.clock());
        throw write ? uncertain() : new Error("Your connected browser did not respond in time. Keep it open and reconnect in Accounts.");
      }
      if (current.callback && !handledCallbacks.has(current.callback.id) && current.callbackResponse == null) {
        handledCallbacks.add(current.callback.id);
        try {
          if (!makeComment || !boundedText(current.callback.context, 2000)) throw invalid();
          const response = await makeComment(current.callback.context);
          if (!mayContinue()) throw new Error("Campaign preparation was stopped.");
          respondDeviceCallback(this.db, command.id, current.callback.id, response, this.clock());
        } catch {
          respondDeviceCallback(this.db, command.id, current.callback.id, { error: "Comment preparation failed. Review this lead before retrying." }, this.clock());
          cancelDeviceCommand(this.db, command.id, "Comment preparation failed.", this.clock());
          throw uncertain();
        }
      }
      await this.sleep(500);
    }
  }
  async openLogin(account: IgAccount): Promise<boolean> {
    const result = await this.execute(account, "openLogin", {});
    if (typeof result !== "boolean") throw invalid();
    return result;
  }
  async readFacts(account: IgAccount, handle: string): Promise<ProfileFacts> {
    if (!handleValid(handle)) throw invalid();
    const result = await this.execute(account, "readFacts", { handle });
    if (!isObject(result) || typeof result.isPublic !== "boolean" || typeof result.linkedToInfyum !== "boolean" || !Number.isSafeInteger(result.followers) || Number(result.followers) < 0 || (result.country !== null && !boundedText(result.country, 100))) throw invalid();
    return { isPublic: result.isPublic, linkedToInfyum: result.linkedToInfyum, followers: result.followers as number, country: result.country as string | null };
  }
  async readProfileNotes(account: IgAccount, handle: string): Promise<string> {
    if (!handleValid(handle)) throw invalid();
    const result = await this.execute(account, "readProfileNotes", { handle });
    if (!boundedText(result, 20_000)) throw invalid();
    return result;
  }
  async readInbox(account: IgAccount): Promise<{ handle: string; text: string }[]> {
    const result = await this.execute(account, "readInbox", {});
    if (!Array.isArray(result) || result.length > 15 || result.some(row => !isObject(row) || !handleValid(row.handle) || !boundedText(row.text, 20_000))) throw invalid();
    return result.map(row => ({ handle: row.handle.toLowerCase(), text: row.text }));
  }
  async warmUp(account: IgAccount, handle: string, pieces: number, makeComment: (context: string) => Promise<string>, mayContinue = () => true): Promise<WarmUpResult> {
    if (!handleValid(handle) || !Number.isSafeInteger(pieces) || pieces < 1 || pieces > 10) throw invalid();
    const result = await this.execute(account, "warmUp", { handle, pieces }, makeComment, mayContinue);
    if (!isObject(result) || !Number.isSafeInteger(result.likes) || Number(result.likes) < 0 || Number(result.likes) > pieces || !Number.isSafeInteger(result.comments) || Number(result.comments) < 0 || Number(result.comments) > pieces || typeof result.followed !== "boolean") throw new InstagramWarmupUncertainError();
    return { likes: result.likes as number, comments: result.comments as number, followed: result.followed };
  }
  async sendMessages(account: IgAccount, handle: string, parts: string[], mayContinue = () => true): Promise<void> {
    if (!handleValid(handle) || !Array.isArray(parts) || parts.length < 1 || parts.length > 3 || parts.some(part => !boundedText(part, 2000) || !part.trim())) throw invalid();
    const result = await this.execute(account, "sendMessages", { handle, parts }, undefined, mayContinue);
    if (result !== null && result !== undefined) throw new InstagramSendUncertainError();
  }
  async close(): Promise<void> {}
}
