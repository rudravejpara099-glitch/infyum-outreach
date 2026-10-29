# Phase 1 lock (build plan step 1)

Build plan step 1 from the Architecture and Build Plan: run real profiles by hand, then make the filters, prompts and sheet columns final so Phase 2 can reuse them. This is that lock. Run on 27 and 28 Oct 2026, one Instagram account, Claude in Chrome as the hands.

## Scope and source (updated 29 Oct 2026)

- **Phase 1 ends after the first DM.** A human takes over once the first message is sent. The kit does not read replies, follow up, or track replies, and it never touches a person again after the first message. Stages end at `DM sent`.
- **Golden source for the process and the first message ideas:** the Google Doc "Outreach Process by Dhrumit Kumbhani" in INFYUM's Drive (nine steps: find, qualify, warm up, analyse the funnel, soft first message, professional alternative, free value, optional visibility, stay friendly). Where it differs from the hand-run rules below, the differences are listed under "Open points".

## What we ran

17 real prospects went through the full checklist by hand.

| Outcome | Count | Notes |
| --- | --- | --- |
| Full sequence and first DM sent | 13 | Story like where there was one, 10 posts liked and commented, follow, DM built from their bio link |
| Engaged, no DM possible | 2 | two accounts with no Message button |
| Skipped before engaging | 2 | one prospect a teammate had already engaged, and one followed by a team account (so connected to Infyum) |
| Real replies so far | 0 | One auto-reply from a comment-bot funnel (a coach's account), which is not a real reply |

Followers of the prospects ran from about 5,000 to 44,000. Replies are out of scope now (see above), so the reply row is history only.

## What the hand runs changed

These are the rules the checklist did not have before.

1. **Skip when DMs are closed.** No Message button on the profile, or a bio or story saying DMs are closed. Engage only, or skip.
2. **Skip when connected to Infyum.** Check Followed by on the profile for any team account.
3. **Check the team has not already worked them.** One prospect had already been engaged by a teammate. This is the strongest reason for one shared lead list.
4. **Never type a comment keyword.** Many coaches run comment-to-DM bots ("Comment FUNDING"). Typing the keyword triggers their bot. Comment about the post instead.
5. **Comment in their language.** Russian, Spanish and French accounts got comments in their own language.
6. **Look at the post, not just the caption.** The picture, reel or carousel decides the comment. Caption-only comments came out generic.
7. **Always comment.** Including faith, politics and sad posts, with a respectful tone. No like-only posts.
8. **Never repeat a comment.** No generic openers (Love this, Great, Nice), no repeated wording across a prospect's posts, and every comment is logged.
9. **One real detail goes in the DM.** From their bio link (a Linktree, a form or a landing page) or their posts. Never "I reviewed your link". The link is now read first and summed up in a one line funnel note.
10. **Check the chat before the first DM.** If our name or link is already in it, do not send.
11. **The first contact is three messages, written fresh each time.** Never a single message, never a fixed template, and checked against the last 10 first DMs for shape, not only openings.

## Locked filters (Settings, Prospect filters)

| Filter | Locked value | Origin |
| --- | --- | --- |
| Followers | Hard range 2,000 to 70,000. Preferred 10,000 to 30,000, contacted first. Optional wider band up to 150,000 (setting, off) | Plan; preferred band and wider band from the team's outreach guide |
| Recent activity | At least 2 posts in the last 14 days | Plan; applied only when the data is known |
| Engagement | Off by default, editable | Plan; needs real data first |
| Niche | Coaches and consultants selling programs online, matched by bio keywords | Plan |
| Fit | Funnel, lead capture or booking gap; can pay $750 or more | Plan, scored 0 to 100 by the writer |
| Fit score gate | Off by default, editable | Built in Phase 2 |
| Exclusions | Private accounts, agencies and competitors, large brands, do-not-contact list, anyone already in the lead list | Plan, plus rules 1 to 3 above |
| Market | English-speaking, ideally US, UK, Canada, Australia | Plan |

Open points:
- The app's older default was 2,000 to 150,000 followers and a United States check. The plan says 2,000 to 70,000. The Settings default is now the plan's value.
- The team's outreach guide prefers 10,000 to 30,000 followers and allows 80,000 to 150,000. The kit keeps 2,000 to 70,000 as the hard filter, uses 10,000 to 30,000 only to order the shortlist, and offers up to 150,000 as a setting. The owner decides whether to change the hard range.
- The guide's comments like "Well explained" are generic openers; the kit still requires a named detail.

## Locked warm-up

In order: follow; like and comment on the pinned post; the story (like, one emoji reaction, a poll vote if there is one; no text replies); comments and likes on the newest posts (up to 5); up to 3 extra likes. At most 1 follow, 12 likes, 6 comments per prospect, cut down to whatever room is left today. A story like, reaction or poll vote counts as a like. Reels may get a small question about the content, carousels a short remark that names the slide. Resharing on our story is not done by Claude. Goal: get noticed and become familiar before the first message.

## Locked comment rules

3 to 8 words plus 1 to 3 emojis. About something visible in this post. No dashes, hashtags, links or business questions (a small question about the content is allowed, at most two per prospect). Never start with a generic opener. Never reuse earlier wording. Their language. Always comment, except grief, death, elections and conflicts you cannot word safely (like only).

## Locked first DM

Exactly three separate messages, written fresh for every person, never a template, sent one at a time with a pause, each confirmed in the chat before the next. Before drafting, the bio link is read (read only) and summed up in one line (`funnel_note`: what they sell, their offer, where the link leads).

1. We looked: one true, specific detail, tied to engagement they have already seen from us where true.
2. Who we are in natural words (the sender's first name, Infyum, a funnel team from India), plus the one allowed link, once, exactly as saved.
3. A light curiosity hook or low pressure question, written fresh for this person. The team's own hook works because the link is relevant to the reader's world and the line invites a click; the mechanism is copied, never the sentence.

Styles: soft (default), or professional (specific praise, who we are, one free sample design). Professional is only for strong fits and only when the free sample offer is ON in Settings (default OFF). No company facts (years, team size) unless listed as approved in Settings.

Rules: each message under about 380 characters; no dashes, no hashtags; no invented results, prices, names or facts; never guess a first name; one link only; their language; at most one emoji in a whole first message and usually none; check the chat before sending; compare with the last 10 first DMs (structure, rhythm, sentence shapes, the hook, order of ideas) and rewrite if too close. The local writer's drafts were weak (for example "I reviewed your link"), so every DM is read and fixed before sending. The Phase 2 prompt wording in `lib/engine/prompts.ts` (and its configurable default text) has not been updated to this design: it only compares against recent openings, and it has no funnel note, no styles and no 10 message shape check.

## Locked lead record (sheet columns)

Same groups as the plan. The app stores these in its database today and the Sheet becomes the synced view in plan step 6.

| Group | Fields | In the app now |
| --- | --- | --- |
| Identity | Username (unique key), name, profile URL, niche, followers | `leads.handle`, `niche`, `followers` |
| Qualification | Engagement rate, last post date, bio link, fit score, source | `fit_score`, `fit_reason`, `source`; bio link and engagement still to capture |
| Engagement | Actions done, comment text, date and time | Activity log (`warmup.comment`, `lead.warmed_up`) |
| First message | Funnel note, DM style (soft or professional), DM text, date and time sent | `messages` (funnel note and style to add) |
| Pipeline | Stage, notes | `stage`, `skip_reason`, `notes` |
| New from the hand runs | DMs possible (yes or no), connected to Infyum (yes or no), bio link used in the DM | to add |

Stages: Found, Qualified, Engaged (Warmed), DM sent. `DM sent` is the end of Phase 1. Skipped carries a reason. Reply status, follow-up and later stages were removed from Phase 1; the Phase 2 app still has fields for them, which Phase 1 does not use.

## Next: build plan step 2 (Foundation)

What each item needs, and who can do it.

| Item | Status | Who |
| --- | --- | --- |
| Repo | Done: `rudravejpara099-glitch/infyum-outreach` | Done |
| Apify token | Needed. The app is built and off until a monthly dollar cap is set | Owner pastes it in Settings |
| Anthropic API key | Needed for metered Claude writing. Today the local writer is used and costs nothing | Owner |
| Google service account and Sheet | Needed for the Sheet sync | Owner creates the account and shares the Sheet |
| Google sign-in | Needed. The app has email and password login today | Owner creates the OAuth client |
| Sheet template | Columns locked above | Can be built once the Google account exists |
