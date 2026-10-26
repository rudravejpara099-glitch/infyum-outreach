import { aiProvider } from "@/lib/domain/local-ai";
import { LocalEngine } from "./local";
import { AnthropicEngine } from "./anthropic";
import type { AiEngine } from "./types";

export type { AiEngine };
export const defaultEngine = (): AiEngine => aiProvider(process.env.AI_PROVIDER) === "local" ? new LocalEngine() : new AnthropicEngine();
