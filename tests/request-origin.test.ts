import { describe, expect, it } from "vitest";
import { isThisComputerRequest } from "@/lib/domain/request-origin";

describe("machine controls are local-only", () => {
  it("allows the browser on this computer", () => {
    expect(isThisComputerRequest({ host: "localhost:3000" })).toBe(true);
    expect(isThisComputerRequest({ host: "127.0.0.1:3000", forwardedFor: "127.0.0.1" })).toBe(true);
  });
  it("refuses tunnels and proxies", () => {
    expect(isThisComputerRequest({ host: "abc.trycloudflare.com" })).toBe(false);
    expect(isThisComputerRequest({ host: "localhost:3000", cfConnectingIp: "203.0.113.9" })).toBe(false);
    expect(isThisComputerRequest({ host: "localhost:3000", forwardedHost: "outreach.vercel.app" })).toBe(false);
    expect(isThisComputerRequest({ host: "localhost:3000", forwardedFor: "203.0.113.9, 127.0.0.1" })).toBe(false);
    expect(isThisComputerRequest({ host: null })).toBe(false);
  });
});
