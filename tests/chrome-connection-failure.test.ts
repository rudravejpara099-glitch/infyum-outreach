import { expect, it } from "vitest";
import { chromeConnectionFailure } from "@/lib/domain/chrome-connection-failure";
import { loginCheckFailure } from "@/lib/domain/browser-mode";
import { ensureChromeToolSucceeded } from "@/worker/chrome-read-only";

it.each([
  ["Cause: connect ECONNREFUSED 127.0.0.1:1234", "connection is closed"],
  ["Cause: ENOENT /Users/private/DevToolsActivePort", "file is missing"],
  ["Cause: EPERM /Users/private/Chrome", "macOS blocked"],
  ["Cause: connect EACCES /Users/private/Chrome", "macOS blocked"],
  ["Cause: socket hang up ECONNRESET", "Chrome disconnected"],
  ["Cause: Unexpected server response: 403", "permission prompt"],
])("preserves the specific wrapped connection cause and hides sensitive details: %s", (cause, expected) => {
  const raw = `Could not connect to Chrome. ${cause} ws://127.0.0.1/devtools/browser/private-token`;
  const message = chromeConnectionFailure(raw)!;
  expect(message).toContain(expected);
  expect(message).not.toContain("private");
  expect(message).not.toContain("ws://");
  expect(loginCheckFailure(message)).toBe(message);
  expect(() => ensureChromeToolSucceeded({ isError: true, content: [{ type: "text", text: raw }] }, "fallback")).toThrow(message);
});
it("does not mislabel a generic connection failure as denied permission", () => {
  expect(chromeConnectionFailure("Could not connect to Chrome.")).toContain("connection is unavailable");
  expect(chromeConnectionFailure("Unrelated page error")).toBeNull();
  expect(loginCheckFailure("Instagram showed a human check with 403")).toContain("Instagram needs you to review");
});
