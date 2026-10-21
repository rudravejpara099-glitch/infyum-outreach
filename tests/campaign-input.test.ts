import { describe, expect, it } from "vitest";
import { parseCampaignForm } from "@/lib/campaign-form";
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: " Test campaign ", audienceText: "Public coaches", country: "United States", minFollowers: "2000", maxFollowers: "150000", approvalRequired: "on", followupsEnabled: "on" })) data.set(key, value);
  return data;
}
describe("campaign form boundaries", () => {
  it("keeps draft campaigns without sender accounts and preserves explicit approval", () => {
    expect(parseCampaignForm(form())).toMatchObject({ input: { name: "Test campaign", approvalRequired: true, followupsEnabled: true }, accountIds: [] });
  });
  it("deduplicates valid sender IDs rather than silently accepting invalid values", () => {
    const data = form(); data.append("accountIds", "1"); data.append("accountIds", "1"); data.append("accountIds", "2");
    expect(parseCampaignForm(data).accountIds).toEqual([1, 2]);
    for (const value of ["-1", "0", "1.5", "NaN", "Infinity", "9007199254740992"]) {
      const invalid = form(); invalid.append("accountIds", value); expect(() => parseCampaignForm(invalid)).toThrow();
    }
  });
  it("rejects reversed follower ranges and empty campaign names", () => {
    const data = form(); data.set("minFollowers", "200000"); expect(() => parseCampaignForm(data)).toThrow();
    const unnamed = form(); unnamed.set("name", "  "); expect(() => parseCampaignForm(unnamed)).toThrow();
  });
});
