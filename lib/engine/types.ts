import type { Db } from "@/lib/db/core";
import type { Source } from "@/lib/billing/types";

export type MeteredAiCall = {
  db: Db;
  userId: number;
  operationId: string;
  source: Source;
  maxOutputTokens: number;
};

// The shared AI contract. Live paid calls require the durable metering context.
export interface AiEngine {
  /** Local-only readiness check before a job can begin Instagram engagement. */
  assertReady?(metering?: MeteredAiCall): void;
  complete(input: { system: string; prompt: string; timeoutMs?: number; metering?: MeteredAiCall }): Promise<string>;
}
