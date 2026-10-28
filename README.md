# INFYUM Instagram Outreach

**Let your own Claude find the right prospects on Instagram, warm them up, and send a first message. You approve, Claude does the clicking. It stops when they reply.**

No app to install. No account to create with us. No permission to ask for. Everything runs through your own Claude and your own Chrome, and everything it saves stays on your computer.

---

## Start in 3 steps (about 5 minutes, once)

**1. Get your two accounts ready**

| You need | Why | Cost |
|---|---|---|
| **Claude** with the **Claude in Chrome** extension | Claude uses it to see and click in your Chrome. Add it from the Chrome Web Store (publisher Anthropic, listed as "Claude") and sign in. It needs a paid Claude plan. [Safety notes from Anthropic](https://support.claude.com/en/articles/12012173-using-claude-in-chrome-safely) | Your Claude plan |
| **An Instagram account, signed in in that Chrome** | The account the messages come from. A spare account is the safe choice. You sign in yourself; Claude never sees your password. | Free |
| *(Optional)* **A free Apify account** | Lets Claude search Instagram for prospects automatically. Without it, Claude searches by hand in Chrome, which is slower. | Free plan, about $5 of credit a month. Every search is capped at 10 cents. |

**2. Paste this into Claude**

```
Set me up with the INFYUM Instagram outreach kit (Phase 1). Read
https://raw.githubusercontent.com/rudravejpara099-glitch/infyum-outreach/main/phase1/GUIDE-FOR-CLAUDE.md
and follow it exactly. Guide me step by step, do the work for me, and ask me before anything is sent or posted.
```

*Using Claude Code? Open the `phase1` folder of this repository in it and type `start`.*

**3. Answer a few quick questions**

Claude asks eight short questions in one message, each with a recommended answer. Say **"yes"** to accept them all, or change what you like. Then Claude finds your first prospects and shows you a short list to approve.

That's it. From then on, you just talk to it.

---

## What a day looks like

| You say | Claude does |
|---|---|
| **"Find 10 prospects"** | Searches, checks each one against your rules, shows you a short list with a reason for each |
| **"Go"** | Takes the next approved prospect: likes their story, likes and comments on their latest posts (each comment written about that specific post), follows them |
| **"Send"** | Shows you the three-part first message for approval, then sends it one part at a time, like a person |
| **"Follow up"** | Writes the day-3 and day-7 follow-ups for people who haven't answered |
| **"Check replies"** | Reads your inbox, tells you who really replied, and hands the conversation to you |
| **"Status"** | Today's counts against your limits, and where every prospect stands |
| **"Stop"** | Stops immediately |

Claude works on **one prospect at a time**, tells you what it did in two lines, and asks before it sends anything.

## What the rules are

Claude follows the same rules we learned by running 17 real prospects by hand. The short version:

- **Who it picks:** public accounts, 2,000 to 70,000 followers, posting recently, coaches and consultants selling programs online, in English-speaking markets. Never agencies, big brands, competitors, private accounts, or anyone you've told it to skip.
- **Who it skips:** anyone whose DMs are closed, anyone connected to your team, anyone already messaged by you or a teammate.
- **Comments:** 3 to 8 words plus an emoji or two, about something visible in that post, never generic ("Love this"), never repeated, in the prospect's language. It never types a coach's comment-to-DM keyword.
- **First message:** three short messages. One true, specific detail from their link or posts. Who you are, with your one link. One curious question. No invented results, no guessed names.
- **Pace:** slow and human. Roughly **5 actions a day in week one**, rising to a steady daily limit by week four, only during your active hours, with pauses between everything.
- **Safety:** at any Instagram warning, Claude stops and tells you. It never keeps clicking.

Everything is written out in [`phase1/GUIDE-FOR-CLAUDE.md`](phase1/GUIDE-FOR-CLAUDE.md), the file your Claude reads. You never have to.

## Your data stays yours

- Your settings, your lead list and the activity log live in a folder on **your** computer: `~/INFYUM-Phase1/`.
- **Passwords and tokens are never typed into the chat.** You sign in to Instagram yourself in Chrome. If you use Apify, you save its key into a file yourself; Claude only reads it to run a capped search.
- This repository is **read-only reference material**: nothing here needs editing, and Claude never edits it.

## Worth knowing

Liking, commenting, following and messaging automatically can go against Instagram's rules, and Instagram can limit an account that behaves unusually. The kit keeps volumes low and human-paced, but it cannot remove that risk. That is why we recommend a spare account. You decide what to use it on.

## Questions

**Do I have to be technical?** No. Claude does the clicking and the typing; you approve.
**Do I need Apify?** No. It saves time and is free to start.
**Do I need an Anthropic API key or to pay for anything else?** No.
**What if Instagram shows a warning?** Claude stops and tells you exactly what it saw. Nothing more happens until you say it's clear.
**Where does it stop?** At the prospect's first real reply. Booking calls and everything after belong to you.
**Can my team use it?** Yes. Each person uses their own Claude, Chrome and Instagram account. Give teammates' accounts to each other as "avoid" lists so nobody is contacted twice.

---

## For developers: what else is in this repository

| Path | What it is |
|---|---|
| [`phase1/`](phase1/) | **The kit above.** The guide your Claude follows, the files it fills in for you, and the optional Apify search tool. |
| [`docs/PHASE-1-LOCK.md`](docs/PHASE-1-LOCK.md) | The locked rules from the hand runs: filters, comment rules, first message, lead columns. |
| [`docs/APP-SETUP.md`](docs/APP-SETUP.md) | Phase 2: the web app that automates the same process, for people running it on their own computer. |
| [`docs/BUILD-PLAN-AUDIT.md`](docs/BUILD-PLAN-AUDIT.md) | How far the Phase 2 app is from the build plan. |
| `app/`, `lib/`, `worker/`, `components/`, `tests/` | The Phase 2 web app (Next.js, TypeScript, SQLite) and its tests. |
| `extension/`, `companion/` | The Phase 2 Chrome extension and the older Node connector that drive Instagram from the app. |
| [`AGENTS.md`](AGENTS.md), [`HANDOFF.md`](HANDOFF.md), [`docs/COLLAB.md`](docs/COLLAB.md) | Notes for the AI agents and people who build the app. |

Phase 1 (this kit) needs none of the app code.
