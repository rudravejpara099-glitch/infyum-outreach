import type { ConnectorKind } from "@/lib/domain/connector";
export type { ConnectorKind } from "@/lib/domain/connector";
export type CommandStatus = "queued" | "running" | "done" | "failed" | "uncertain";
export type DeviceCallback = { id: string; context: string };
export type DeviceCallbackResponse = { id: string; response: string | { error: string } };
export type Command = {
  id: string; deviceId: string; accountId: number; jobId: number; jobAttempt: number; kind: ConnectorKind;
  args: Record<string, unknown>; status: CommandStatus; expiresAt: number;
  result: unknown; error: string | null; callback?: DeviceCallback; callbackResponse?: DeviceCallbackResponse;
};
/** Wire commands expose only a sender handle and validated operation arguments, never server filesystem paths. */
export type WireCommand = Pick<Command, "id" | "kind" | "args" | "expiresAt"> & { account: { id: number; handle: string } };
