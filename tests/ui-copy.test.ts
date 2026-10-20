import { expect, it } from "vitest";
import { activityLabel, messageKindLabel, messageStatusLabel, stageCopy } from "@/lib/ui/copy";
import { STAGES } from "@/lib/domain/stages";

it("explains every existing lead stage without changing the stored stage", () => {
  for (const stage of STAGES) {
    expect(stageCopy[stage].label.length).toBeGreaterThan(2);
    expect(stageCopy[stage].description.length).toBeGreaterThan(15);
    expect(stageCopy[stage].label).not.toContain("_");
  }
  expect(stageCopy.dm_sent.label).toBe("Contacted");
});
it("distinguishes waiting, approved and actually sent messages", () => {
  expect(messageStatusLabel("pending_approval")).toBe("Needs your review");
  expect(messageStatusLabel("approved")).toBe("Waiting to send");
  expect(messageStatusLabel("sent")).toBe("Sent");
  expect(messageKindLabel("dm")).toBe("First message");
});
it("turns technical events into useful explanations without implying success", () => {
  expect(activityLabel("message.pending_approval")).toBe("Message ready for review");
  expect(activityLabel("account.connected")).toBe("Instagram account added");
  expect(activityLabel("job.error")).toBe("A task couldn’t finish");
  expect(activityLabel("send.limit_reached")).toBe("Daily sending limit reached");
});
it("does not expose unknown internal event codes as normal UI labels", () => {
  expect(activityLabel("future_job.internal_error")).toBe("Activity recorded");
  expect(messageStatusLabel("future_status")).toBe("Status unavailable");
});
