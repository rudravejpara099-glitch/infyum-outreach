import { AnthropicEngine } from "./anthropic";
import type { AiEngine } from "./types";

export type { AiEngine };
export const defaultEngine = (): AiEngine => new AnthropicEngine();
