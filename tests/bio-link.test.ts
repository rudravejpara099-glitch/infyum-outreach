import { describe, expect, it, vi } from "vitest";
import { readBioLinkPage, summarizeHtml, withBioLinkPage, type BioFetch } from "@/lib/services/bio-link";

const html = `<html><head><title>Kami | Ignite</title><meta name="description" content="Join the 2026 retreat"><script>var secret = 1</script></head><body><a href="/a">Ignite 2026</a><a href="/b">Podcast</a><p>Welcome &amp; hello</p></body></html>`;
const ok = (body: string, contentType = "text/html"): BioFetch => async () => ({ status: 200, location: null, contentType, text: async () => body });
const publicOnly = async () => true;

describe("bio link page", () => {
  it("summarizes title, description, link labels and visible text without scripts", () => {
    const s = summarizeHtml(html);
    expect(s).toContain("Title: Kami | Ignite");
    expect(s).toContain("Description: Join the 2026 retreat");
    expect(s).toContain("Link labels on the page: Ignite 2026 | Podcast");
    expect(s).toContain("Welcome & hello");
    expect(s).not.toContain("secret");
  });

  it("reads a public page", async () => expect(await readBioLinkPage("https://linktr.ee/kami", ok(html), publicOnly)).toContain("Ignite 2026"));

  it("follows a redirect but never to a private address", async () => {
    const fetcher = vi.fn<BioFetch>()
      .mockResolvedValueOnce({ status: 302, location: "http://169.254.169.254/latest", contentType: "", text: async () => "" });
    expect(await readBioLinkPage("https://short.example.com/x", fetcher, publicOnly)).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const hostCheck = vi.fn(async (host: string) => host !== "internal.example.com");
    expect(await readBioLinkPage("https://short.example.com/x", vi.fn<BioFetch>().mockResolvedValueOnce({ status: 301, location: "https://internal.example.com/", contentType: "", text: async () => "" }), hostCheck)).toBe("");
  });

  it("refuses unsafe addresses, non-page content, errors and failures without throwing", async () => {
    expect(await readBioLinkPage("http://localhost/x", ok(html), publicOnly)).toBe("");
    expect(await readBioLinkPage("https://example.com/f.pdf", ok("%PDF", "application/pdf"), publicOnly)).toBe("");
    expect(await readBioLinkPage("https://example.com/", async () => ({ status: 404, location: null, contentType: "text/html", text: async () => "x" }), publicOnly)).toBe("");
    expect(await readBioLinkPage("https://example.com/", async () => { throw new Error("boom"); }, publicOnly)).toBe("");
  });

  it("adds the page to the notes, or says it could not be read, or leaves notes alone with no link", async () => {
    expect(await withBioLinkPage("Profile\nBio link URL: https://linktr.ee/kami", ok(html), publicOnly)).toContain("What the bio link page shows (linktr.ee):");
    expect(await withBioLinkPage("Profile\nBio link URL: https://linktr.ee/kami", ok(html, "application/pdf"), publicOnly)).toContain("could not be read");
    expect(await withBioLinkPage("Profile only")).toBe("Profile only");
  });
});
