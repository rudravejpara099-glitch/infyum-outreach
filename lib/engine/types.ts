// The only thing the rest of the app knows about the AI. To switch to paid API billing later,
// write another class that implements this and change one line in lib/engine/index.ts.
export interface AiEngine {
  complete(input: { system: string; prompt: string; timeoutMs?: number }): Promise<string>;
}
