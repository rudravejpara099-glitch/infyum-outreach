# Phase 1 lock (build plan step 1)

Build plan step 1 from the Architecture and Build Plan: run real profiles by hand, then make the filters, prompts and sheet columns final so Phase 2 can reuse them. This is that lock. Run on 27 and 28 Oct 2026, one Instagram account, Claude in Chrome as the hands.

## What we ran

17 real prospects went through the full checklist by hand.

| Outcome | Count | Notes |
| --- | --- | --- |
| Full sequence and first DM sent | 13 | Story like where there was one, 10 posts liked and commented, follow, DM built from their bio link |
| Engaged, no DM possible | 2 | two accounts with no Message button |
| Skipped before engaging | 2 | one prospect a teammate had already engaged, and one followed by a team account (so connected to Infyum) |
| Real replies so far | 0 | One auto-reply from a comment-bot funnel (a coach's account), which is not a real reply |

Followers of the prospects ran from about 5,000 to 44,000. Reply tracking is still unproven.

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
9. **One real detail from their link goes in the DM.** Their bio link, a Linktree, a form or a landing page. Never "I reviewed your link".
10. **Check the chat before the first DM.** If our name or link is already in it, do not send.

## Locked filters (Settings, Prospect filters)

| Filter | Locked value | Origin |
| --- | --- | --- |
| Followers | 2,000 to 70,000 | Requirement in the plan |
| Recent activity | At least 2 posts in the last 14 days | Plan; applied only when the data is known |
| Engagement | Off by default, editable | Plan; needs real data first |
| Niche | Coaches and consultants selling programs online, matched by bio keywords | Plan |
| Fit | Funnel, lead capture or booking gap; can pay $750 or more | Plan, scored 0 to 100 by the writer |
| Fit score gate | Off by default, editable | Built in Phase 2 |
| Exclusions | Private accounts, agencies and competitors, large brands, do-not-contact list, anyone already in the lead list | Plan, plus rules 1 to 3 above |
| Market | English-speaking, ideally US, UK, Canada, Australia | Plan |

Open point: the app's older default was 2,000 to 150,000 followers and a United States check. The plan says 2,000 to 70,000. The Settings default is now the plan's value.

## Locked comment rules

3 to 8 words plus 1 to 3 emojis. About something visible in this post. No dashes, hashtags, links or business questions. Never start with a generic opener. Never reuse earlier wording. Their language. Always comment.

## Locked first DM

Three separate messages, sent one at a time with a pause, each confirmed in the chat before the next.

1. One true, specific detail from their link or posts.
2. Who we are: "I'm Rudra at Infyum, a small team in India that builds sales funnels and booking pages." Plus the one allowed link.
3. One curious question about how they get people from Instagram to a booked call.

No dashes, no invented results or prices, no guessed names. The local writer's drafts were weak (for example "I reviewed your link"), so every DM was read and fixed before sending. Prompt wording lives in `lib/engine/prompts.ts`.

## Locked lead record (sheet columns)

Same groups as the plan. The app stores these in its database today and the Sheet becomes the synced view in plan step 6.

| Group | Fields | In the app now |
| --- | --- | --- |
| Identity | Username (unique key), name, profile URL, niche, followers | `leads.handle`, `niche`, `followers` |
| Qualification | Engagement rate, last post date, bio link, fit score, source | `fit_score`, `fit_reason`, `source`; bio link and engagement still to capture |
| Engagement | Actions done, comment text, date and time | Activity log (`warmup.comment`, `lead.warmed_up`) |
| DM and follow-up | DM text, date and time, reply status, reply date, next follow-up due | `messages`, `next_followup_at` |
| Pipeline | Stage, notes | `stage`, `skip_reason`, `notes` |
| New from the hand runs | DMs possible (yes or no), connected to Infyum (yes or no), bio link used in the DM | to add |

Stages: Found, Qualified, Engaged (Warmed), DM sent, Replied, Follow-up due, Call booked, Closed, Dead. Skipped carries a reason.

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
