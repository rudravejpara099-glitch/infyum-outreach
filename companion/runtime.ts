import { randomUUID } from "node:crypto";
import type { WireCommand, DeviceCallbackResponse } from "../lib/connectors/protocol";
import type { InstagramDriver } from "../worker/driver";
import { InstagramBlockedError, InstagramSendUncertainError, InstagramWarmupUncertainError } from "../worker/driver";
import type { IgAccount } from "../lib/db/types";
import { validConnectorArgs } from "../lib/domain/connector";
import { serverOrigin, type DeviceCredential } from "./connection";

type ActiveCommand = WireCommand & { callbackResponse?: DeviceCallbackResponse };
type PollResult = { continue?: boolean; command: ActiveCommand | null };
export class DisconnectedError extends Error {}
export class ConnectorRuntime {
  private credential: DeviceCredential | null = null;
  private seen = new Set<string>();
  private active: ActiveCommand | null = null;
  private allowedAt = 0;
  private callbackResponse: DeviceCallbackResponse | undefined;
  private polling = false;
  private stopped = false;
  status = "Paste your connection code to begin.";
  constructor(private readonly driver: InstagramDriver, private readonly request: typeof fetch = fetch,
    private readonly now = Date.now, private readonly pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    private readonly onCredential: (value: DeviceCredential | null) => void = () => {}) {}
  restore(value: DeviceCredential): void { serverOrigin(value.origin); this.credential = value; this.status = "Connecting to your workspace…"; }
  isConnected(): boolean { return this.credential !== null; }
  /** Closing the app pauses actions without making the user pair again next launch. */
  stop(): void { this.stopped = true; this.allowedAt = 0; this.status = "Connector closed. Reopen Outreach Connector to resume."; }
  disconnect(): void { this.stopped = true; this.allowedAt = 0; this.credential = null; this.onCredential(null); this.status = "Disconnected. Your Instagram sign-in stays in Chrome."; }
  private async post<T>(path: string, body: unknown, credential = this.credential): Promise<T> {
    if (!credential) throw new DisconnectedError("Connect this device first.");
    const response = await this.request(`${serverOrigin(credential.origin)}${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${credential.token}` }, body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) { this.disconnect(); throw new DisconnectedError("This connection was revoked. Create a new connection code in Outreach."); }
    if (!response.ok) throw new Error("The website could not complete this connection request. Try again from Outreach.");
    return await response.json() as T;
  }
  async pair(origin: string, code: string, label: string): Promise<void> {
    const safeOrigin = serverOrigin(origin);
    const response = await this.request(`${safeOrigin}/api/connector/pair`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ code, label }) });
    if (!response.ok) throw new Error("The connection code expired or was already used. Create a new one in Outreach.");
    const paired = await response.json() as Omit<DeviceCredential, "origin">;
    if (typeof paired.token !== "string" || !paired.token || typeof paired.device?.id !== "string") throw new Error("The website returned an invalid device connection.");
    this.credential = { origin: safeOrigin, token: paired.token, device: { id: paired.device.id, workspaceId: paired.device.workspaceId, userId: paired.device.userId, label: paired.device.label, lastSeen: paired.device.lastSeen } };
    this.stopped = false;
    this.onCredential(this.credential);
    this.status = "Connected. Keep this app and your signed-in Chrome open.";
  }
  private mayContinue = (): boolean => !this.stopped && this.credential !== null && this.allowedAt > 0 && this.now() - this.allowedAt < 5_000;
  private async refresh(command: ActiveCommand): Promise<void> {
    const state = await this.post<PollResult>("/api/connector/poll", { commandId: command.id });
    if (state.continue !== true || state.command?.id !== command.id) { this.allowedAt = 0; throw new Error("This operation was stopped in Outreach."); }
    this.allowedAt = this.now();
    this.callbackResponse = state.command.callbackResponse;
  }
  private async comment(context: string): Promise<string> {
    const command = this.active;
    if (!command || !this.mayContinue()) throw new Error("Connection lost. Preparation stopped.");
    const callbackId = randomUUID();
    await this.post("/api/connector/callback", { id: command.id, callbackId, context });
    const deadline = this.now() + 120_000;
    while (this.mayContinue() && this.now() < deadline) {
      if (this.callbackResponse?.id === callbackId) {
        const response = this.callbackResponse.response;
        if (typeof response === "string") return response;
        throw new Error("Writing is unavailable. Connect a metered writing provider in Outreach before preparation.");
      }
      await this.pause(100);
    }
    throw new Error("Writing did not complete. Preparation stopped.");
  }
  private async dispatch(command: ActiveCommand): Promise<unknown> {
    const account: IgAccount = { id: command.account.id, handle: command.account.handle, label: "", profileDir: "", browserMode: "chrome_read_only", dailyCap: 10, rampStart: "", status: "active", statusNote: "" };
    const args = command.args;
    if (!validConnectorArgs(command.kind, args)) throw new Error("This operation is invalid.");
    if (!Number.isSafeInteger(account.id) || account.id < 1 || !/^[a-zA-Z0-9._]{1,30}$/.test(account.handle)) throw new Error("The saved Instagram account is invalid.");
    const handle = () => { if (typeof args.handle !== "string" || !/^[a-zA-Z0-9._]{1,30}$/.test(args.handle)) throw new Error("Invalid Instagram profile."); return args.handle; };
    if (!this.mayContinue()) throw new Error("The connection is not current. Operation stopped.");
    switch (command.kind) {
      case "openLogin": return await this.driver.openLogin(account);
      case "readFacts": return await this.driver.readFacts(account, handle());
      case "readProfileNotes": return await this.driver.readProfileNotes(account, handle());
      case "readInbox": return await this.driver.readInbox(account);
      case "warmUp": {
        if (args.pieces !== 10) throw new Error("Preparation requires ten posts.");
        return await this.driver.warmUp(account, handle(), 10, context => this.comment(context), this.mayContinue);
      }
      case "sendMessages": {
        if (!Array.isArray(args.parts) || args.parts.length < 1 || args.parts.length > 3 || args.parts.some(part => typeof part !== "string" || !part.trim() || part.length > 5000)) throw new Error("The approved message is invalid.");
        await this.driver.sendMessages(account, handle(), args.parts as string[], this.mayContinue);
        return null;
      }
      default: throw new Error("This operation is not supported by the connector.");
    }
  }
  async tick(): Promise<void> {
    if (!this.credential || this.active || this.polling || this.stopped) return;
    this.polling = true;
    try {
      const { command } = await this.post<PollResult>("/api/connector/poll", {});
      if (!command) { this.status = "Connected. Waiting for an action in Outreach."; return; }
      if (this.seen.has(command.id)) { this.status = "An earlier operation needs review in Outreach. It was not repeated."; return; }
      this.seen.add(command.id);
      if (command.expiresAt <= this.now()) throw new Error("The operation expired. Retry from Outreach.");
      this.active = command;
      this.allowedAt = this.now();
      this.status = command.kind === "openLogin" ? "Checking your signed-in Instagram in Chrome…" : "Working on the action requested in Outreach…";
      let watching = true;
      const monitor = (async () => { while (watching && !this.stopped) { await this.pause(1_000); if (!watching) break; try { await this.refresh(command); } catch { this.allowedAt = 0; } } })();
      try {
        // The server must confirm the claimed command is still authorized before any browser action.
        await this.refresh(command);
        const result = await this.dispatch(command);
        if (!this.mayContinue()) throw new Error("Connection lost before completion was confirmed.");
        await this.post("/api/connector/result", { id: command.id, result });
        this.status = "Finished. Check Outreach for the result.";
      } catch (error) {
        const uncertain = command.kind === "warmUp" || command.kind === "sendMessages";
        try { await this.post("/api/connector/result", { id: command.id, error: error instanceof InstagramBlockedError ? "Instagram needs your attention. Review the account in Chrome." : "The operation did not finish. Review it in Outreach before retrying.", uncertain, blockedByInstagram: error instanceof InstagramBlockedError || ((error instanceof InstagramSendUncertainError || error instanceof InstagramWarmupUncertainError) && error.blockedByInstagram) }); } catch { /* Server holds unacknowledged work; never replay it. */ }
        this.status = uncertain ? "This action needs review in Outreach. It will not be repeated automatically." : "This check did not finish. Check your connection and retry from Outreach.";
      } finally { watching = false; await monitor; this.active = null; this.allowedAt = 0; this.callbackResponse = undefined; }
    } catch (error) { this.allowedAt = 0; if (!(error instanceof DisconnectedError)) this.status = "Website unavailable. Browser actions are paused until it reconnects."; }
    finally { this.polling = false; }
  }
}
