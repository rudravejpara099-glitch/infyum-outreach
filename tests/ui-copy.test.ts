import { describe, expect, it } from "vitest";
import { STAGES } from "@/lib/domain/stages";
import { activityLabel, actorLabel, jobErrorLabel, jobTypeLabel, loginJobSummary, loginWindowHint, messageKindLabel, messageStatusLabel, navigationCopy, stageCopy } from "@/lib/ui/copy";

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
    expect(messageStatusLabel("failed")).toBe("Needs checking");
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

  it("explains whether an Instagram sign-in request is waiting for background work", () => {
    expect(loginWindowHint(false)).toBe("This sign-in request needs to be started again from the account.");
    expect(loginWindowHint(true)).toBe("Outreach is opening the sign-in window.");
  });

  it("reports Instagram sign-in only after the session check confirms it", () => {
    expect(loginJobSummary({ status: "done", lastError: "", payload: { authenticated: true } }, false)).toMatchObject({ title: "Instagram is connected", tone: "success" });
    expect(loginJobSummary({ status: "done", lastError: "", payload: { authenticated: false } }, false)).toMatchObject({ title: "Sign-in wasn’t completed", tone: "attention" });
    expect(loginJobSummary({ status: "done", lastError: "" }, false).title).toBe("Sign-in window opened");
  });

  it("shows the real sign-in window outcome without claiming the account is authenticated", () => {
    expect(loginJobSummary(null, true)).toMatchObject({ title: "Sign-in status not checked", tone: "neutral" });
    expect(loginJobSummary({ status: "queued", lastError: "" }, false)).toMatchObject({ title: "Sign-in window is waiting", tone: "waiting" });
    expect(loginJobSummary({ status: "running", lastError: "" }, true)).toMatchObject({ title: "Opening sign-in window", tone: "waiting" });
    const opened = loginJobSummary({ status: "done", lastError: "" }, true);
    expect(opened.title).toBe("Sign-in window opened");
    expect(opened.detail).toContain("does not confirm the account is signed in");
    expect(loginJobSummary({ status: "failed", lastError: "" }, true)).toMatchObject({ title: "Could not open the sign-in window", tone: "error" });
  });

  it("shows failed task names and known login errors in plain language", () => {
    expect(jobTypeLabel("open_login")).toBe("Open Instagram sign-in");
    expect(jobTypeLabel("send")).toBe("Send a message");
    expect(jobTypeLabel("unknown_task")).toBe("Background task");
    expect(jobErrorLabel("open_login", "replaced by the owner signed-in Chrome")).toBe("Your existing Chrome session replaced the Instagram sign-in window.");
    expect(jobErrorLabel("send", "Instagram was unavailable")).toBe("The app could not send this message. Check the Instagram conversation before trying again.");
    expect(jobErrorLabel("send", "A message may have been sent. Check the Instagram conversation before trying again.")).toContain("may have gone through");
    expect(jobErrorLabel("send", "No message was sent. Instagram could not open the conversation after repeated attempts.")).toContain("No message was sent");
  });
  it("labels uncertain message outcomes as needing a human check", () => {
    expect(messageStatusLabel("failed")).toBe("Needs checking");
    expect(activityLabel("message.uncertain_returned_for_review")).toBe("Unsent message returned for review");
  });
});
