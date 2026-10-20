"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { getLead } from "@/lib/db/repos/leads";
import { createOutgoing, listMessages } from "@/lib/db/repos/messages";

/** The team writes a reply. It goes through the same approval rules as any other message. */
export async function writeReply(form: FormData) {
  const user = await requireUser();
  const db = getDb();
  const lead = getLead(db, Number(form.get("id")));
  const text = String(form.get("text") ?? "").trim();
  if (!lead || !text) return;
  const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
  const lastIncoming = listMessages(db, { leadId: lead.id }).find((m) => m.direction === "in");
  const message = createOutgoing(db, {
    leadId: lead.id, accountId: lead.accountId, kind: "reply", parts: [text],
    campaign: campaign ?? { approvalRequired: true }, incomingText: lastIncoming?.parts.join(" "),
  }, user.email);
  revalidatePath("/inbox");
  return { message: message.status === "pending_approval" ? "Reply saved for review. Open Review messages to approve it." : "Reply saved and waiting to send." };
}
