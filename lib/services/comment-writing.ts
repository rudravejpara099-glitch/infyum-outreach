import { warmupCommentError } from "@/lib/domain/warmup-comment";
import { COMMENT_SYSTEM, commentPrompt } from "@/lib/engine/prompts";
import type { AiEngine, MeteredAiCall } from "@/lib/engine/types";

/** Retry invalid returned text only; uncertain/provider failures propagate without replay. */
export async function draftWarmupComment(engine: AiEngine, context: string, metering?: MeteredAiCall): Promise<string> {
  const prompt = commentPrompt(context);
  let rejection: string | null = null;
  let previous = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const call = metering ? {
      ...metering, maxOutputTokens: 160,
      operationId: attempt === 1 ? metering.operationId : `${metering.operationId}:retry:${attempt}`,
    } : undefined;
    const raw = await engine.complete({
      system: COMMENT_SYSTEM,
      prompt: rejection ? `${prompt}\n\nThe previous draft ${JSON.stringify(previous)} was rejected: ${rejection}\nCount the written words before answering; emoji do not count. Aim for five written words about the post, plus one emoji. Write a new comment that follows every rule. Return only the comment text.` : prompt,
      maxOutputTokens: 160, metering: call,
    });
    const comment = raw.replace(/[—–]/g, ",").trim().replace(/^["']|["']$/g, "").trim();
    previous = comment;
    rejection = warmupCommentError(comment);
    if (!rejection) return comment;
  }
  throw new Error(`Comment writing did not return valid text after 3 attempts. ${rejection}`);
}
