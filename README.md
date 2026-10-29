# INFYUM Instagram Outreach

**Paste this repo into your Claude. It guides you through a 5-minute setup, then finds the right prospects on Instagram, warms them up like a real person, and sends a friendly first message. You approve, Claude does the clicking. It stops once the first message is sent: from there, the conversation is yours.**

Nothing to install. No files to download. No account to create with us, and no permission to ask for. Claude does it all from its own tools.

---

## Start

**1. Have these ready** (Claude will remind you and help with each one):

| What | Why | Cost |
|---|---|---|
| **Claude** (desktop app) with the **Claude in Chrome** extension | Claude uses it to see and click in your Chrome, like a person would. Add it from the Chrome Web Store (publisher Anthropic) and sign in. It needs a paid Claude plan. [Anthropic's safety notes](https://support.claude.com/en/articles/12012173-using-claude-in-chrome-safely) | Your Claude plan |
| **An Instagram account, signed in in that Chrome** | The account the messages come from. A spare account is the safe choice. You sign in yourself, **in the Chrome profile that Claude in Chrome is connected to**; Claude never sees your password. | Free |

**2. Paste this into Claude**

```
Set me up with the INFYUM Instagram outreach kit (Phase 1). Read
https://raw.githubusercontent.com/rudravejpara099-glitch/infyum-outreach/main/phase1/GUIDE-FOR-CLAUDE.md
and follow it exactly. Tell me up front what I need to do, guide me step by step, do the work for me, and ask me before anything is sent or posted.
```

**3. Follow Claude.** It tells you everything you'll do before you do it:

| You | Claude |
|---|---|
| **Sign in to Instagram** in Chrome | Checks it worked, asks a few quick questions (each with a recommended answer; say "yes" to accept) |
| **Connect Apify** (optional): one click, then sign in. No key to copy. | Uses it to search Instagram for prospects. [Apify's free plan](https://docs.apify.com/integrations/mcp) includes about $5 a month. |
| **Connect Google Sheets** (optional): one click, then sign in | Keeps your lead list in a Google Sheet in your own Drive, so nothing is ever lost |
| Say **"yes"** to a short list of prospects | Checks each one against your rules, warms them up, then writes a fresh first message for each |
| Say **"yes"** to the batch of messages | Sends them, one part at a time, like a person |
| Say **"schedule"** when you're happy | Sets up Claude's **scheduled tasks** so it keeps warming up and messaging approved prospects every day within your limits |

It is a few minutes the first time. After that you just talk to it. **Claude only asks you about the things that matter**: the list of prospects, and the first messages, in batches. It never asks about each like or comment.

---

## What a day looks like

| You say | Claude does |
|---|---|
| **"Find 10 prospects"** | Searches, checks each one against your rules, shows a short list with a reason for each |
| **"Go"** | Takes the next approved prospect and warms them up without asking: follows them, comments on their pinned post, reacts to their story (like, an emoji, a poll vote when there is one), and likes and comments on a few recent posts (each comment about that specific post). You see the first prospect's comments once, to check the style. Then it writes their first message. |
| **"Send"** | Shows you every first message in one table. You say yes (or edit or skip), and it sends them, one part at a time like a person. Then that person is **yours**: Claude never touches them again. |
| **"Schedule"** | Creates a daily schedule in Claude's scheduled tasks. It only warms up approved prospects and sends approved first messages, inside your limits. |
| **"Status"** / **"Stop"** | Shows today's counts and where everyone stands (Found, Qualified, Engaged, DM sent) / stops immediately |

**About scheduling.** Claude's [scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork) that use Chrome run on your computer: it needs to be awake, with Claude Desktop and Chrome open. Claude tells you this before it sets anything up.

## What the rules are

Claude follows the rules we learned by running 17 real prospects by hand:

- **Who it picks:** public accounts, 2,000 to 70,000 followers (accounts with 10,000 to 30,000 come first on your list, because they answer more; you can widen the limit to 150,000), posting recently, coaches and consultants selling programs online, in English-speaking markets. Never agencies, big brands, competitors, private accounts, or anyone you've told it to skip.
- **Who it skips:** anyone whose DMs are closed, anyone connected to your team, anyone already messaged by you or a teammate.
- **Warm-up:** follow, a comment on their pinned post, a story like and emoji, a few comments and likes on recent posts. Comments are 3 to 8 words plus an emoji or two, about something visible in that post, never generic ("Love this"), never repeated, in the prospect's language. It never types a coach's comment-to-DM keyword and never replies to a story with text.
- **First message:** exactly three short messages, written fresh for every person, never a template and never the same shape twice in a row. One true, specific detail that shows Claude really looked (it first reads their bio link to understand what they sell). Who you are, with your one link. A light, curious closing line. Friendly and non-pushy, no invented results, no guessed names. If you turn it on, strong-fit prospects can instead get a more professional version that offers one free sample design (off by default).
- **Pace:** slow and human. **5 of each action a day in week one** (5 likes, 5 comments, 5 follows, 5 first messages), rising to a steady daily limit by week four, only during your active hours, with pauses between everything.
- **Safety:** at any Instagram warning, Claude stops and tells you. It never keeps clicking.

It's all written out in [`phase1/GUIDE-FOR-CLAUDE.md`](phase1/GUIDE-FOR-CLAUDE.md), the file your Claude reads. You never have to.

## Your data stays yours

- Your lead list lives in **your** Google Sheet in **your** Drive (or, if you skip Google, in your chat). We never see it.
- **Passwords and keys are never typed into the chat.** You sign in to Instagram, Apify and Google yourself, in your own browser.
- This repository is **read-only reference material**: nothing here needs editing, and Claude never edits it.
- What you type to Claude goes to Anthropic as usual, and searches go to Apify.

## Worth knowing

Liking, commenting, following, reacting and messaging automatically can go against Instagram's rules, and Instagram can limit an account that behaves unusually. The kit keeps volumes low and human-paced, but it cannot remove that risk. That is why we recommend a spare account. You decide what to use it on.

## Questions

**Do I have to be technical?** No. Claude does the clicking and the typing; you approve.
**Is anything installed on my computer?** Only the Claude in Chrome extension, which you add yourself. The kit itself installs nothing.
**Do I need Apify or Google Sheets?** No, both are optional. Without Apify, Claude searches by hand in Chrome (slower). Without Google, your list stays in the chat.
**Do I need an Anthropic API key or to pay for anything else?** No.
**What if Instagram shows a warning?** Claude stops and tells you exactly what it saw. Nothing more happens until you say it's clear.
**Where does it stop?** After the first message. Once all three parts are sent, that person is yours: Claude does not read replies, follow up, or contact them again.
**Can my team use it?** Yes. Each person uses their own Claude, Chrome and Instagram account. Pick "INFYUM team" at the start and the team's rules (never contact someone a teammate has already worked) are built in. Put everyone's leads in one shared Sheet.

---

## For developers: what else is in this repository

| Path | What it is |
|---|---|
| [`phase1/`](phase1/) | **The kit above.** One file: the guide your Claude follows, including the INFYUM team preset. |
| [`docs/PHASE-1-LOCK.md`](docs/PHASE-1-LOCK.md) | The locked rules from the hand runs and the team's outreach guide: filters, warm-up, comment rules, first message, lead columns. |
| [`docs/APP-SETUP.md`](docs/APP-SETUP.md) | Phase 2: the web app that automates the same process, for people running it on their own computer. |
| [`docs/BUILD-PLAN-AUDIT.md`](docs/BUILD-PLAN-AUDIT.md) | How far the Phase 2 app is from the build plan. |
| `app/`, `lib/`, `worker/`, `components/`, `tests/` | The Phase 2 web app (Next.js, TypeScript, SQLite) and its tests. |
| `extension/`, `companion/` | The Phase 2 Chrome extension and the older Node connector that drive Instagram from the app. |
| [`AGENTS.md`](AGENTS.md), [`HANDOFF.md`](HANDOFF.md), [`docs/COLLAB.md`](docs/COLLAB.md) | Notes for the AI agents and people who build the app. |

Phase 1 (this kit) needs none of the app code.
