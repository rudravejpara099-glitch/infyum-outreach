# INFYUM Instagram Outreach

**Paste this repo into your Claude. It guides you through a 5-minute setup, then finds the right prospects on Instagram, warms them up like a real person, and sends a friendly first message. You say yes to a short list of prospects, Claude does the rest. It stops once the first message is sent: from there, the conversation is yours.**

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
and follow it exactly. Tell me up front what I need to do, guide me step by step, do the work for me, and only ask me about the list of prospects and anything unexpected.
```

**3. Follow Claude.** It tells you everything you'll do before you do it:

| You | Claude |
|---|---|
| **Sign in to Instagram** in Chrome | Checks it worked, asks a few quick questions (each with a recommended answer; say "yes" to accept) |
| **Connect Apify** (optional): one click, then sign in. No key to copy. | Uses it to search Instagram for prospects. [Apify's free plan](https://docs.apify.com/integrations/mcp) includes about $5 a month. |
| **Connect Google Sheets** (optional for your own business; **required for the INFYUM team**, using the Google account the team Sheet was shared with): one click, then sign in | Keeps your lead list in a Google Sheet in your own Drive, so nothing is ever lost |
| Tell it **how many profiles** (for example "do 7 profiles") | Finds them, checks each one against your rules itself, warms them up, then writes a fresh first message for each. No list to approve. |
| Say **"schedule"** when you're happy | Sets up Claude's **scheduled tasks** so it keeps finding and messaging new prospects every day |

It is a few minutes the first time. After that you just talk to it. **Claude only asks you about the things that matter**: the list of prospects, and anything unexpected. It never asks about a like, a comment or a message: it writes and sends those itself.

---

## What a day looks like

| You say | Claude does |
|---|---|
| **"Find 10 prospects"** | Searches, checks each one against your rules, shows a short list with a reason for each |
| **"Start" / "Do 7 profiles"** | Finds prospects, checks them itself, and warms each one up without asking: follows them, then likes and comments on a random handful of their recent posts (some skipped, any order), and sometimes reacts to a story. Comments are in a voice that fits the person and the post. Then it writes their first message and sends it. That person is then **yours**: Claude never touches them again. |
| **"Schedule"** | Creates a daily schedule in Claude's scheduled tasks. It runs the same loop on its own: finds, warms up and messages new prospects. |
| **"Status"** / **"Stop"** | Shows today's counts and where everyone stands (Found, Qualified, Engaged, DM sent) / stops immediately |

**About scheduling.** Claude's [scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork) that use Chrome run on your computer: it needs to be awake, with Claude Desktop and Chrome open. Claude tells you this before it sets anything up.

## What the rules are

Claude follows the rules we learned by running 17 real prospects by hand:

- **Who it picks:** public accounts, 2,000 to 70,000 followers (accounts with 10,000 to 30,000 come first on your list, because they answer more; you can widen the limit to 150,000), posting recently, coaches and consultants selling programs online, in English-speaking markets. Never agencies, big brands, competitors, private accounts, or anyone you've told it to skip.
- **Who it skips:** anyone whose DMs are closed, anyone connected to your team, anyone already messaged by you or a teammate.
- **Warm-up:** like a person browsing, not a script. Claude follows, then likes and comments on a random few of their recent posts (skipping many, in any order), and sometimes reacts to a story. Comments are written in a voice that fits the person and the post, with humour when it fits, never generic, never repeated, in the prospect's language. It never types a coach's comment-to-DM keyword and never replies to a story with text.
- **First message:** written fresh for every person, in a voice that fits them. No template and no fixed shape: one to three messages in whatever order and length fits. Claude reads their profile and bio link, then opens from something genuine it likes about them or a real pain point it can see, says who you are, and usually ends with a question that fits their business. It learns from past messages and replies in the team Sheet without copying them. Friendly and non-pushy, no invented results or numbers, no guessed names, no links except the ones you set. A free sample design is offered only if you turn that on (off by default).
- **Pace:** no daily caps and no fixed waits. Claude decides its own pauses, breaks and number of actions like a real person would, and varies them.
- **Warnings:** Instagram blocks and warnings are logged and worked around; Claude does not stop for them. It only stops if it is signed out or Instagram asks you to verify your identity.

It's all written out in [`phase1/GUIDE-FOR-CLAUDE.md`](phase1/GUIDE-FOR-CLAUDE.md), the file your Claude reads. You never have to.

## Your data stays yours

- Your lead list lives in **your** Google Sheet in **your** Drive (or, if you skip Google, in your chat). We never see it. INFYUM teammates instead share one private team Sheet, which only invited people can open.
- **Passwords and keys are never typed into the chat.** You sign in to Instagram, Apify and Google yourself, in your own browser.
- This repository is **read-only reference material**: nothing here needs editing, and Claude never edits it.
- What you type to Claude goes to Anthropic as usual, and searches go to Apify.

## Worth knowing

Liking, commenting, following, reacting and messaging automatically can go against Instagram's rules, and Instagram can limit an account that behaves unusually. The kit runs with no caps, human-paced by Claude's own judgment, so that risk is real. That is why we recommend a spare account. You decide what to use it on.

## Questions

**Do I have to be technical?** No. Claude does the clicking and the typing; you just say how many profiles.
**Is anything installed on my computer?** Only the Claude in Chrome extension, which you add yourself. The kit itself installs nothing.
**Do I need Apify or Google Sheets?** No, both are optional. Without Apify, Claude searches by hand in Chrome (slower). Without Google, your list stays in the chat.
**Do I need an Anthropic API key or to pay for anything else?** No.
**What if Instagram shows a warning?** Claude logs it, skips that action and carries on. If Instagram signs it out or asks you to verify, it tells you and waits.
**Where does it stop?** After the first message. Once the message is sent, that person is yours: Claude does not read replies, follow up, or contact them again.
**Can my team use it?** Yes. Each person uses their own Claude, Chrome and Instagram account. Pick "INFYUM team" at the start and the team's rules (never contact someone a teammate has already worked) are built in. The team shares one Sheet ("INFYUM Outreach Database"), so nobody is ever contacted twice.

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
