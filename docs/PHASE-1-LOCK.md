# Phase 1 lock (build plan step 1)

Build plan step 1 from the Architecture and Build Plan: run real profiles by hand, then make the filters, prompts and sheet columns final so Phase 2 can reuse them. This is that lock. Run on 27 and 28 Oct 2026, one Instagram account, Claude in Chrome as the hands.

## Scope and source (updated 29 Oct 2026)

- **Phase 1 ends after the first DM.** A human takes over once the first message is sent. The kit does not read replies, follow up, or track replies, and it never touches a person again after the first message. Stages end at `DM sent`.
- **Process document:** none. The earlier Google Doc "Outreach Process by Dhrumit Kumbhani" has been dropped; only the order (find, qualify, warm up, first message) and the hand-run rules below remain.

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
7. **Comments are the person's own voice, not a quota (updated 29 Oct 2026).** Some posts get a comment, some only a like. On faith, politics, grief and sad posts: a like, or one plain line of warmth, and no joke.
8. **Never repeat a comment.** No generic openers (Love this, Great, Nice), no repeated wording across a prospect's posts, and every comment is logged.
9. **One real detail goes in the DM.** From their bio link (a Linktree, a form or a landing page) or their posts. Never "I reviewed your link". The link is now read first and summed up in a one line funnel note.
10. **Check the chat before the first DM.** If our name or link is already in it, do not send.
11. **The first contact is written fresh each time, with no fixed shape (updated 29 Oct 2026).** It is one to three messages in a voice that fits the person, never a fixed template, and checked against the last 10 first DMs for shape, not only openings. The goal is a reply that leads to a booked call with our closer.

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

## Locked warm-up, comments and first DM (rewritten 29 Oct 2026: human, free-form, no approval)

The earlier fixed sequence (follow, pinned post, story, newest 5 posts), the 3 to 8 word comment rule and the three-message first DM with worked examples and a hook formula are retired. They produced a recognisable pattern. The Phase 1 guide (`phase1/GUIDE-FOR-CLAUDE.md`, sections 4.3 and 4.4) describes goals and hard limits only; Claude chooses everything else per person, and nothing is shown to the user for approval except the prospect shortlist.

**Warm-up.** Claude looks at the profile like a person, then decides freshly: whether and when to follow; which posts to touch (random picks from roughly the newest 12, any order, many skipped, the pinned post optional); like only, comment only, both or nothing per post (more likes than comments); the story sometimes (like, emoji or poll vote, never a text reply); uneven pauses; the number of actions varies from visit to visit and day to day, and a visit may be split across the day. Daily limits per action type still apply; if room is short it does less, never more.

**Comments.** A voice chosen per person and post (playful, dry, warm, nerdy, blunt, deadpan), humour welcome when the post invites it and never at the person's expense. Any length a real person would type, no emoji quota. Never generic filler, never repeated wording (checked against the Activity Log), their language, no links, hashtags, long dashes, pitching or business questions, and never a comment keyword. Grief, death, illness, elections and conflict: like only or one plain line of warmth. Posted without asking; the exact text is logged in the Activity Log before posting.

**First DM.** Written fresh by Claude's own judgment, one to three messages, any order, any length, no template. Claude first learns from recent rows in the Sheet (`dm_text`, and where people filled them `replied` and `reply_note`) and borrows what worked without copying wording. It opens from something genuine it appreciates about the person (a goal, a result, a cause) or a real pain point it can see, and usually ends with a question that fits their business. Required: one true specific detail, who we are in natural words (facts as in Settings), and a light reason to reply. Optional: our portfolio link, and one work sample near their niche when Settings has one (never more than two links, always as saved). One outcome question is allowed ("would more booked calls from Instagram be useful?") but never invented numbers, promised results or timeframes. Never a pitch, a call request, guilt, pressure, invented facts, a guessed name or any link not in Settings. Before sending, Claude silently asks whether a real person who looked at this account would send it, rewrites if not, and checks the last 10 first DMs so each reads as written by a different person. It checks the chat first (never message someone already contacted), writes the full text into `dm_text` and logs it before sending, and sends one part at a time with varied pauses. There is no approval step. The free sample design is offered only when `free_sample_offer` is on in Settings.

## Locked lead record (the team Sheet, updated 29 Oct 2026)

The team Sheet "INFYUM Outreach Database" is the single store for the team. Tabs: Start here, Today, All Leads (formula), Leads_<Name> (one per person), Activity Log (add-only), Team, plus hidden Settings and Leads_Template. There are no Claims, Do-not-contact, Waiting or Checks tabs.

| Tab | Columns |
| --- | --- |
| Leads_<Name> | member, username, profile_url, niche, followers, fit, stage, skip_reason, source, warmup_status, dm_sent_at, dm_text, notes, updated_at, claimed_at, replied, reply_note |
| Activity Log | date, time, member, username, action, result, detail |
| Team | member, ig_username, status, start_date, time_zone, utc_offset_hours, then formulas: local_date, day_number, limits, used, left |

`replied` and `reply_note` are filled by people only; Claude never writes them and never reads Instagram replies. The one-line funnel note goes in `notes` as `funnel: …`.

Duplicates: before acting, look the username up in All Leads; add my row first; look it up again; if it appears twice, the later claim (by `claimed_at`, then position in All Leads) backs off as Skipped with note `duplicate`. "Do not contact" is a Skipped row with that note.

Stages: Found, Qualified, Engaged, DM sent, Skipped. `DM sent` is the end of Phase 1. Reply status, follow-up and later stages are out of scope; the Phase 2 app still has fields for them, which Phase 1 does not use.

## Next: build plan step 2 (Foundation)

What each item needs, and who can do it.

| Item | Status | Who |
| --- | --- | --- |
| Repo | Done: `rudravejpara099-glitch/infyum-outreach` | Done |
| Apify token | Needed. The app is built and off until a monthly dollar cap is set | Owner pastes it in Settings |
| Anthropic API key | Needed for metered Claude writing. Today the local writer is used and costs nothing | Owner |
| Google service account and Sheet | Needed for the Sheet sync | Owner creates the account and shares the Sheet |
| Google sign-in | Needed. The app has email and password login today | Owner creates the OAuth client |
| Sheet template | Built: the team Sheet above | Done |
