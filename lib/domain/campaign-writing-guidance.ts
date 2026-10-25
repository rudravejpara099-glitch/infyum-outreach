import type { WritingReadiness } from "./writing-readiness";

/** Explain the selected writer without implying paid billing is required for local inference. */
export function campaignWritingGuidance(writer: Pick<WritingReadiness, "provider" | "available">): string {
  if (writer.provider === "local") return writer.available
    ? "Free writing is connected. Outreach can prepare comments and message drafts automatically without a paid API. Messages still follow this campaign’s approval setting."
    : "Preparation is waiting for the free writing service. Ask your workspace administrator to reconnect it in Settings. No paid writing is used instead.";
  if (writer.provider === "invalid") return "Preparation is waiting for writing setup. Ask your workspace administrator to check Settings before starting.";
  return writer.available
    ? "Automatic comments and drafts use metered AI and require an approved spending limit. Messages still follow this campaign’s approval setting."
    : "Automatic writing is off. Ask your workspace administrator to connect free writing or metered AI. After real engagement, you can also mark the lead Engaged and write its message for review.";
}
