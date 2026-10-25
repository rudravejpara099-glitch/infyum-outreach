import { expect, it } from "vitest";
import { requestAuthorized } from "../companion/local-server";
import { connectorPage } from "../companion/page";

it("local requests require a private token and matching origin and host", () => {
  const origin = "http://127.0.0.1:43120", token = "private-local-token";
  const request = { method: "POST", headers: { host: "127.0.0.1:43120", origin, "x-connector-token": token } };
  expect(requestAuthorized(request, origin, token)).toBe(true);
  expect(requestAuthorized({ ...request, headers: { ...request.headers, origin: "https://attacker.example" } }, origin, token)).toBe(false);
  expect(requestAuthorized({ ...request, headers: { ...request.headers, host: "attacker.example" } }, origin, token)).toBe(false);
  expect(requestAuthorized({ ...request, headers: { ...request.headers, "x-connector-token": "wrong" } }, origin, token)).toBe(false);
  expect(requestAuthorized({ method: "POST", headers: { host: "127.0.0.1:43120", "x-connector-token": token } }, origin, token)).toBe(false);
  expect(requestAuthorized({ method: "GET", headers: { host: "127.0.0.1:43120", "x-connector-token": token } }, origin, token)).toBe(true);
});
it("asks the user to review the website before allowing connection", () => {
  const html = connectorPage("nonce");
  expect(html).toContain("Review connection"); expect(html).toContain("Allow and connect");
  expect(html).toContain("website,allow:true"); expect(html).toContain("el('permission').hidden=true");
  expect(html).toContain("prefers-color-scheme:dark"); expect(html).toContain("aria-live");
  expect(html).toContain("Quit connector"); expect(html).toContain("request('/quit',{})");
  expect(html).toContain("clearInterval(statusTimer)");
});
