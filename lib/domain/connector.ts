export const DEVICE_PAIRING_TTL_MS = 5 * 60_000;
export const connectorKinds = ["openLogin", "readFacts", "readProfileNotes", "readInbox", "warmUp", "sendMessages"] as const;
export type ConnectorKind = typeof connectorKinds[number];
export function isConnectorKind(value: unknown): value is ConnectorKind { return connectorKinds.includes(value as ConnectorKind); }
export function connectorWrites(kind: ConnectorKind): boolean { return kind === "warmUp" || kind === "sendMessages"; }
/** A device may request at most one generated comment per requested post. */
export function canRequestConnectorComment(pieces: unknown, issued: number): boolean {
  return Number.isSafeInteger(pieces) && Number(pieces) >= 1 && Number(pieces) <= 10
    && Number.isSafeInteger(issued) && issued >= 0 && issued < Number(pieces);
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
const handle = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.]{1,30}$/.test(value);
export function validConnectorArgs(kind: ConnectorKind, value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (kind === "openLogin" || kind === "readInbox") return keys === "";
  if (!handle(value.handle)) return false;
  if (kind === "warmUp") return keys === "handle,pieces" && Number.isSafeInteger(value.pieces) && Number(value.pieces) >= 1 && Number(value.pieces) <= 10;
  if (kind === "sendMessages") return keys === "handle,parts" && Array.isArray(value.parts) && value.parts.length >= 1 && value.parts.length <= 3 && value.parts.every(part => text(part, 2000));
  return keys === "handle";
}
export function validConnectorResult(kind: ConnectorKind, value: unknown): boolean {
  if (kind === "openLogin") return typeof value === "boolean";
  if (kind === "sendMessages") return value === null;
  if (kind === "readProfileNotes") return typeof value === "string" && value.length <= 30_000 && !value.includes("\0");
  if (kind === "readInbox") return Array.isArray(value) && value.length <= 100 && value.every(row => object(row) && Object.keys(row).sort().join(",") === "handle,text" && handle(row.handle) && text(row.text, 10_000));
  if (!object(value)) return false;
  if (kind === "readFacts") return Object.keys(value).sort().join(",") === "country,followers,isPublic,linkedToInfyum" && typeof value.isPublic === "boolean" && typeof value.linkedToInfyum === "boolean" && Number.isSafeInteger(value.followers) && Number(value.followers) >= 0 && Number(value.followers) <= 10_000_000_000 && (value.country === null || text(value.country, 100));
  return Object.keys(value).sort().join(",") === "comments,followed,likes" && typeof value.followed === "boolean" && [value.likes, value.comments].every(n => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 10);
}
export function connectorKindAllowed(jobType: string, kind: ConnectorKind): boolean {
  const allowed: Record<string, ConnectorKind[]> = { open_login: ["openLogin"], qualify: ["readFacts"], warmup: ["warmUp"], draft_dm: ["readProfileNotes"], draft_followup: ["readProfileNotes"], check_inbox: ["openLogin", "readInbox"], send: ["sendMessages"] };
  return allowed[jobType]?.includes(kind) ?? false;
}
