import { ClaudeCliEngine } from "./claude-cli";
import type { AiEngine } from "./types";

export type { AiEngine };
export const defaultEngine = (): AiEngine => new ClaudeCliEngine({ model: process.env.AI_MODEL ?? "sonnet" });
