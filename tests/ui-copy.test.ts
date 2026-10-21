import { describe, expect, it } from "vitest";
import { STAGES } from "@/lib/domain/stages";
import { activityLabel, actorLabel, jobErrorLabel, jobTypeLabel, loginWindowHint, messageKindLabel, messageStatusLabel, navigationCopy, stageCopy } from "@/lib/ui/copy";

describe("plain-language UI copy", () => {
  it("covers only the current first-reply pipeline stages", () => {
    expect(Object.keys(stageCopy)).toEqual(STAGES);
    expect(stageCopy.replied.description).toContain("your team takes over");
    expect(stageCopy.closed.description).toContain("No more messages");
  });

  it("uses direct navigation and message labels", () => {
    expect(navigationCopy).toMatchObject({ "/": "Overview", "/pipeline": "Lead progress", "/approvals": "Review messages", "/inbox": "Replies", "/activity": "History" });
    expect(messageKindLabel("dm")).toBe("First message");
    expect(messageKindLabel("followup")).toBe("Follow-up");
    expect(messageKindLabel("reply")).toBe("Message");
    expect(messageStatusLabel("pending_approval")).toBe("Needs review");
    expect(messageStatusLabel("approved")).toBe("Queued");
    expect(messageStatusLabel("failed")).toBe("Could not send");
    expect(messageStatusLabel("future_status")).toBe("Status unavailable");
  });

  it("hides internal event and actor identifiers from history labels", () => {
    expect(activityLabel("lead.handoff")).toBe("Lead replied; conversation handed over");
    expect(activityLabel("message.sent.dm")).toBe("First message sent");
    expect(activityLabel("pace.after_send")).toBe("Work break scheduled");
    expect(activityLabel("unknown.internal.event")).toBe("Activity recorded");
    expect(actorLabel("worker")).toBe("Outreach assistant");
    expect(actorLabel("rudra@example.test")).toBe("rudra@example.test");
  });

  it("explains whether a login request is waiting for or being handled by the worker", () => {
    expect(loginWindowHint(false)).toBe("Waiting for the worker to start.");
    expect(loginWindowHint(true)).toBe("The worker is handling this request.");
  });

  it("shows failed task names and known login errors in plain language", () => {
    expect(jobTypeLabel("open_login")).toBe("Open Instagram sign-in");
    expect(jobTypeLabel("send")).toBe("Send a message");
    expect(jobTypeLabel("unknown_task")).toBe("Background task");
    expect(jobErrorLabel("open_login", "replaced by the owner signed-in Chrome")).toBe("Your existing Chrome session replaced the Instagram sign-in window.");
    expect(jobErrorLabel("send", "Instagram was unavailable")).toBe("Instagram was unavailable");
  });
});
