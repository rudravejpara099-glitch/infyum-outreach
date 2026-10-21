import { describe, expect, it } from "vitest";
import { CAMPAIGN_STATUS_LABEL } from "@/components/campaign-status";

describe("campaign status labels", () => {
  it("shows plain, consistent status wording in campaign lists and details", () => {
    expect(CAMPAIGN_STATUS_LABEL).toEqual({
      draft: "Draft",
      active: "Active",
      paused: "Paused",
      done: "Finished",
    });
  });
});
