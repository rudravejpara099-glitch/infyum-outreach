import { needsHuman } from "./sensitive";

export type ApprovalDecision = { needsApproval: boolean; reasons: string[] };

/** The one rule for "does a human look at this first?". Used for DMs and replies. */
export function decideApproval(opts: {
  campaignApprovalRequired: boolean;
  incoming?: string;
  outgoing: string;
  similarityFlag?: boolean;
  /** Extra reasons that force a person to look, for example a concern raised by the reviewer pass. */
  extraReasons?: string[];
}): ApprovalDecision {
  const reasons: string[] = [];
  if (opts.campaignApprovalRequired) reasons.push("Campaign requires approval");
  if (opts.similarityFlag) reasons.push("Looks too similar to a recent message");
  for (const reason of opts.extraReasons ?? []) reasons.push(reason);
  for (const topic of needsHuman(opts.incoming ?? "", opts.outgoing)) reasons.push(`Mentions ${topic}`);
  return { needsApproval: reasons.length > 0, reasons };
}
