// The gate. Pure function: facts in, verdict out. Checks run in a fixed order and
// stop at the first failure so the "why" shown to the team is always the first problem.
export type LeadFacts = {
  isPublic: boolean;
  /** Country from "About this account"; null when Instagram shows "Not shared". */
  country: string | null;
  followers: number;
  linkedToInfyum: boolean;
  alreadyContacted: boolean;
  onDoNotContact: boolean;
};

export type AudienceRules = {
  minFollowers: number;
  maxFollowers: number;
  country: string; // e.g. "United States"
};

export type Verdict = { ok: true } | { ok: false; reason: string };

export function qualify(facts: LeadFacts, rules: AudienceRules): Verdict {
  if (facts.onDoNotContact) return fail("On the do-not-contact list");
  if (facts.alreadyContacted) return fail("Already contacted");
  if (!facts.isPublic) return fail("Account is private");
  // Instagram often hides the country or fails to load it; that no longer stops a lead. It is flagged for the person instead.
  if (facts.country !== null && facts.country !== rules.country) return fail(`Based in ${facts.country}`);
  if (facts.followers < rules.minFollowers) return fail(`Only ${facts.followers} followers (min ${rules.minFollowers})`);
  if (facts.followers > rules.maxFollowers) return fail(`${facts.followers} followers (max ${rules.maxFollowers})`);
  if (facts.linkedToInfyum) return fail("Already connected: this account follows them, or they follow it");
  return { ok: true };
}

function fail(reason: string): Verdict {
  return { ok: false, reason };
}
