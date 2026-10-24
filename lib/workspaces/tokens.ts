import { createHash, randomBytes } from "node:crypto";

export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const isToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);
