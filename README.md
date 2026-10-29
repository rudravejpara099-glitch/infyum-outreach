# INFYUM Instagram Outreach

**Paste this repo into your Claude. It guides you through a 5-minute setup, then finds the right prospects on Instagram, warms them up like a real person, and sends a first message. You approve, Claude does the clicking. It stops at their first reply.**

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
| Say **"yes"** to a short list of prospects | Checks each one against your rules, then engages and writes the first messages |
| Say **"yes"** to a message | Sends it, one part at a time, like a person |
| Say **"schedule"** when you're happy | Sets up Claude's **scheduled tasks** so it keeps going every day within your limits |

It is a few minutes the first time. After that you just talk to it.

---

## What a day looks like

| You say | Claude does |
|---|---|
| **"Find 10 prospects"** | Searches, checks each one against your rules, shows a short list with a reason for each |
| **"Go"** | Takes the next approved prospect: shows you the comments it plans to post, then likes their story (when they have one), likes and comments on their latest posts (each comment written about that specific post), and follows them |
| **"Send"** | Shows you the three-part first message for approval, then sends it one part at a time |
| **"Follow up"** | Writes the day-3 and day-7 follow-ups for people who haven't answered |
| **"Check replies"** | Reads your inbox, tells you who really replied, and hands the conversation to you |
| **"Schedule"** | Creates a daily schedule in Claude's scheduled tasks. It only does what you've already approved, inside your limits. |
| **"Status"** / **"Stop"** | Shows today's counts and where everyone stands / stops immediately |

**About scheduling.** Claude's [scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork) that use Chrome run on your computer: it needs to be awake, with Claude Desktop and Chrome open. Claude tells you this before it sets anything up.

## What the rules are

Claude follows the rules we learned by running 17 real prospects by hand:

- **Who it picks:** public accounts, 2,000 to 70,000 followers, posting recently, coaches and consultants selling programs online, in English-speaking markets. Never agencies, big brands, competitors, private accounts, or anyone you've told it to skip.
- **Who it skips:** anyone whose DMs are closed, anyone connected to your team, anyone already messaged by you or a teammate.
- **Comments:** 3 to 8 words plus an emoji or two, about something visible in that post, never generic ("Love this"), never repeated, in the prospect's language. It never types a coach's comment-to-DM keyword.
- **First message:** three short messages. One true, specific detail from their link or posts. Who you are, with your one link. One curious question. No invented results, no guessed names.
- **Pace:** slow and human. **5 of each action a day in week one** (5 likes, 5 comments, 5 follows, 5 messages), rising to a steady daily limit by week four, only during your active hours, with pauses between everything.
- **Safety:** at any Instagram warning, Claude stops and tells you. It never keeps clicking.

It's all written out in [`phase1/GUIDE-FOR-CLAUDE.md`](phase1/GUIDE-FOR-CLAUDE.md), the file your Claude reads. You never have to.

## Your data stays yours

- Your lead list lives in **your** Google Sheet in **your** Drive (or, if you skip Google, in your chat). We never see it.
- **Passwords and keys are never typed into the chat.** You sign in to Instagram, Apify and Google yourself, in your own browser.
- This repository is **read-only reference material**: nothing here needs editing, and Claude never edits it.
- What you type to Claude goes to Anthropic as usual, and searches go to Apify.

## Worth knowing

Liking, commenting, following and messaging automatically can go against Instagram's rules, and Instagram can limit an account that behaves unusually. The kit keeps volumes low and human-paced, but it cannot remove that risk. That is why we recommend a spare account. You decide what to use it on.

## Questions

**Do I have to be technical?** No. Claude does the clicking and the typing; you approve.
**Is anything installed on my computer?** Only the Claude in Chrome extension, which you add yourself. The kit itself installs nothing.
**Do I need Apify or Google Sheets?** No, both are optional. Without Apify, Claude searches by hand in Chrome (slower). Without Google, your list stays in the chat.
**Do I need an Anthropic API key or to pay for anything else?** No.
**What if Instagram shows a warning?** Claude stops and tells you exactly what it saw. Nothing more happens until you say it's clear.
**Where does it stop?** At the prospect's first real reply. Booking calls and everything after belong to you.
**Can my team use it?** Yes. Each person uses their own Claude, Chrome and Instagram account. Pick "INFYUM team" at the start and the team's rules (never contact someone a teammate has already worked) are built in. Put everyone's leads in one shared Sheet.

---

## For developers: what else is in this repository

| Path | What it is |
|---|---|
| [`phase1/`](phase1/) | **The kit above.** One file: the guide your Claude follows, including the INFYUM team preset. |
| [`docs/PHASE-1-LOCK.md`](docs/PHASE-1-LOCK.md) | The locked rules from the hand runs: filters, comment rules, first message, lead columns. |
| [`docs/APP-SETUP.md`](docs/APP-SETUP.md) | Phase 2: the web app that automates the same process, for people running it on their own computer. |
| [`docs/BUILD-PLAN-AUDIT.md`](docs/BUILD-PLAN-AUDIT.md) | How far the Phase 2 app is from the build plan. |
| `app/`, `lib/`, `worker/`, `components/`, `tests/` | The Phase 2 web app (Next.js, TypeScript, SQLite) and its tests. |
| `extension/`, `companion/` | The Phase 2 Chrome extension and the older Node connector that drive Instagram from the app. |
| [`AGENTS.md`](AGENTS.md), [`HANDOFF.md`](HANDOFF.md), [`docs/COLLAB.md`](docs/COLLAB.md) | Notes for the AI agents and people who build the app. |

Phase 1 (this kit) needs none of the app code.
