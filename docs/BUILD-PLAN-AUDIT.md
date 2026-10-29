> **Status note, 2026-10-29:** this is the original line-by-line gap list from 2026-10-28. Current status and the work order live in [`BUILD-SLABS.md`](BUILD-SLABS.md).

# Build plan audit

Each line of "INFYUM Instagram Outreach: Architecture and Build Plan" (Sunil, 27 Oct 2026) checked against the code. "Matches" means the code was read and a test covers it. "Not run live" means it exists but has never been run against real Instagram or a real Apify token.

## Step 3: Task 1 in the app

| Doc says | State |
| --- | --- |
| Followers 2,000 to 70,000 | Matches (Settings, default) |
| Recent activity: last 14 days, at least 2 posts | Matches |
| Engagement: likes plus comments per follower on the last 5 to 10 posts, above a set minimum | Field exists as a percent. Default is off. Needs a real default once we see real data |
| Niche, business size, selling and affordability signals | Niche keywords exist. The rest are scored by the fit prompt, not separate filters |
| Market: English-speaking, US, UK, Canada, Australia | Field exists, default empty |
| Exclusions: already in sheet, do-not-contact, agencies, private accounts, large brands | Do-not-contact, private and already-in-list match. Agencies and large brands rely on the exclude keywords |
| Claude fit score 0 to 100, only leads above the threshold move on | Matches. Threshold default is off (0) |
| Apify call | Built. Not run live (no token) |
| Lead table | Built |

## Step 4: Drafts and approval

Approve, edit or reject screen exists. First DM is three messages. Not run on real data through the Claude API (the local writer has been used so far).

## Step 5: Chrome extension

| Doc says | State |
| --- | --- |
| Pairing, job pickup, result reporting | Built, merged. Not yet loaded in Chrome |
| Read profile facts and notes | Built |
| Like, comment, follow, optional story reply, DM | Not built. Still done by the older worker |
| Human pacing in the extension | Not built (the worker has it) |
| Kill switch in the extension | Not built |

## Step 6: Tracking

| Doc says | State |
| --- | --- |
| Stage updates, activity log | Built |
| Duplicate checks before queueing and before every action | Built in the app database |
| Follow-up on day 3 and day 7, maximum 2 | Fixed. Was day 2 and day 6 |
| Google Sheet as the only data store, with tabs Leads, Settings, Jobs, Activity Log, Do-not-contact | Not built. The app uses its own database. The sheet sync is the missing piece |
| Header row locked, Stage dropdown | Not built |
| Reply tracking manual in the MVP | We go further: the app reads the inbox |

## Step 7: Safety and dashboard

| Doc says | State |
| --- | --- |
| Warm-up ramp about 5 actions a day in week one, rising slowly | Fixed. Was 10 a day. Now 5, then 10, then 20, then the full cap |
| Daily caps on follows, likes, comments and DMs, set in Settings | Only one cap per account (DMs), not in Settings. Not built |
| Randomized delays of 8 to 12 seconds between actions, plus occasional longer breaks | Fixed. Between posts was 8 to 30 seconds |
| Active hours in the user's timezone | Built (9am to 9pm). Timezone is in Settings; the hours are not editable |
| Stop at once on any Instagram warning and report it | Built (account is set to blocked) |
| Kill switch in the web app and in the extension | Pause exists per account and campaign. No single kill switch. Not in the extension |
| Never retry a blocked action more than twice | Built (3 attempts) |
| Drafts need approval by default | Matches |
| Today's counts on the dashboard | Built |

## Other parts of the MVP list

| Doc says | State |
| --- | --- |
| Login with Google sign-in | Not built. Email and password today |
| Settings: filters, caps, sender details, DM and comment prompts, all editable | Filters done. Caps, sender details and prompts are not editable (prompts live in code) |
| Four action buttons: Find leads, Engage, Send DMs, Follow up | Not built as four buttons. The worker runs these on its own |
| Claude API (Sonnet 5.5) writes comments and DMs | Provider exists. Model is set in the database; the default has not been checked against Sonnet 5.5 |

## Order to close the gaps

1. Settings: editable caps, sender details, prompts, active hours.
2. Per-action daily caps (follows, likes, comments, DMs) and one kill switch.
3. Extension: like, comment, follow, DM, pacing, kill switch.
4. Four action buttons.
5. Google sheet sync (tabs, locked header, Stage dropdown). Needs the Google service account.
6. Google sign-in. Needs the Google OAuth client.
7. Step 8: five leads end to end on a spare account.
