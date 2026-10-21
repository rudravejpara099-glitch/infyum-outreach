import type { Campaign } from "@/lib/db/types";

export const CAMPAIGN_STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Finished",
};
