import { warmupCommentError } from "@/lib/domain/warmup-comment";
import { COMMENT_SYSTEM, commentPrompt } from "@/lib/engine/prompts";
import type { AiEngine, MeteredAiCall } from "@/lib/engine/types";

/** Retry invalid returned text only; uncertain/provider failures propagate without replay. */
const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
const opener = (text: string) => norm(text).split(" ").slice(0, 3).join(" ");
/** Why a comment is too samey: generic opener, or the same opening/words as one already posted. */
export function repeatedCommentError(comment: string, avoid: string[]): string | null {
  if (/^(love|loving|great|nice|amazing|awesome) (this|it|that)\b/i.test(norm(comment))) return "Do not open with a generic phrase like 'Love this'. Start with a concrete detail from the post.";
  const mine = norm(comment);
  for (const used of avoid) {
    if (norm(used) === mine || (opener(used) === opener(comment) && mine.length > 0)) return `It repeats an earlier comment (${JSON.stringify(used)}). Use a different opening and different wording.`;
  }
  return null;
}

export async function draftWarmupComment(engine: AiEngine, context: string, metering?: MeteredAiCall, avoid: string[] = []): Promise<string> {
  const prompt = commentPrompt(context, avoid.slice(-12));
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
    rejection = warmupCommentError(comment) ?? repeatedCommentError(comment, avoid);
    if (!rejection) return comment;
  }
  throw new Error(`Comment writing did not return valid text after 3 attempts. ${rejection}`);
}
