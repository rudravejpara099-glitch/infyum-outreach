import { describe, expect, it } from "vitest";
import { bioLinkFromNotes, decodeBioLink, formatProfileNotes, isSafeBioUrl, pickBioLink } from "@/lib/domain/profile-notes";

describe("profile notes", () => {
  it("decodes Instagram's wrapped outgoing links and ignores Instagram's own", () => {
    expect(decodeBioLink("https://l.instagram.com/?u=https%3A%2F%2Flinktr.ee%2Fkami&e=abc")).toBe("https://linktr.ee/kami");
    expect(decodeBioLink("https://www.instagram.com/explore/")).toBeNull();
    expect(decodeBioLink("https://l.instagram.com/?u=javascript%3Aalert(1)")).toBeNull();
    expect(pickBioLink(["https://www.instagram.com/p/x/", "https://calendly.com/anthony/call"])).toBe("https://calendly.com/anthony/call");
  });

  it("formats header, bio link, highlights and post captions with dates and places", () => {
    const notes = formatProfileNotes({
      header: "Kami Guildner\n2.3K followers\nBusiness coach",
      pageTop: "Kami Guildner\n2.3K followers\nBusiness coach\nIgnite\nPodcast",
      links: ["https://l.instagram.com/?u=https%3A%2F%2Fignite.example.com%2F"],
      posts: [{ caption: "Day 2 of Ignite was unreal", date: "2026-11-06", location: "Denver, Colorado" }, { caption: "  " }],
      alts: ["Photo by Kami on November 6"],
    });
    expect(notes).toContain("Bio link URL: https://ignite.example.com/");
    expect(notes).toContain("highlight titles");
    expect(notes).toContain("- 2026-11-06, at Denver, Colorado: Day 2 of Ignite was unreal");
    expect(notes).not.toContain("image descriptions");
    expect(bioLinkFromNotes(notes)).toBe("https://ignite.example.com/");
  });

  it("falls back to image descriptions when no caption could be read, and has no bio link line when there is none", () => {
    const notes = formatProfileNotes({ header: "Name", alts: ["Photo by X on a date, may be an image of text"] });
    expect(notes).toContain("image descriptions only");
    expect(bioLinkFromNotes(notes)).toBeNull();
  });

  it("only allows ordinary public web addresses", () => {
    for (const bad of ["http://localhost/x", "https://127.0.0.1/", "https://10.0.0.5/", "https://[::1]/", "ftp://example.com/", "https://user:pw@example.com/", "https://intranet/", "https://printer.local/"]) expect(isSafeBioUrl(bad), bad).toBe(false);
    expect(isSafeBioUrl("https://linktr.ee/kami")).toBe(true);
  });
});
