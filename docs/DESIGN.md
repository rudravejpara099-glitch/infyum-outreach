# Design brief: how this app must look and behave

Goal: calm, fast, trustworthy. A tool people use all day, so information design beats decoration. It must not look like generic AI output.

## Direction
- Owner-approved revision, 2026-10-20: a liquid-glass workspace with depth and fluid interactions. Use the plain app name “Outreach”; no Infyum logo or company branding in navigation, authentication, metadata or application chrome. Business identity in outbound message rules is unchanged.
- Apply HIG psychology: clear next action, essentials before details, familiar controls and direct feedback. Glass belongs to navigation and controls; readable content uses steadier surfaces. Use a neutral blue/graphite palette, with semantic success/warning colours. Headings Plus Jakarta Sans, text Inter.
- Light, dark and system appearance. Remember an explicit choice on this device. Short route/disclosure transitions and tactile control feedback; honour reduced motion. No idle background animation or pointer-driven camera movement.
- Tokens live in `app/globals.css` (`--bg --surface --ink --muted --line --accent --ok --warn --bad` and soft variants). Never hard-code a colour in a component.

## Rules
1. Light AND dark, both designed, both checked. Contrast at least WCAG AA (4.5:1 text).
2. Works from 390 px phone width to wide desktop. No horizontal page scroll; wide tables scroll inside their own container.
3. Show state with form, not only words: badges, pills, a stripe for what needs attention. Put the summary before the detail.
4. Every list has a designed empty state that says what will appear and what to do first. Every form shows what went wrong and how to fix it.
5. Every control has a visible keyboard focus. Respect reduced motion. Use real labels, not placeholders only.
6. One accent colour. Do not decorate every card the same way; reserve border, fill and shadow for the element that needs setting apart.
7. Optical gradients, highlights and shadows may express material depth, per the owner’s approved liquid-glass direction. Avoid the generic-AI look: purple-to-blue gradients, emoji as section markers, everything centred, the same radius and shadow on everything, hero banners on a tool.
8. Copy: plain and specific, active voice, say what happens ("Approve for sending"). No filler, no apologies, no clever labels.
9. Numbers align (`tabular-nums`). Dates and times are shown in the team time zone.
10. Most-used screens (Pipeline board, Approvals, Inbox) get the most polish: fast scan, clear primary action, safe destructive actions.

## Process
Use the `hig-foundations` and `hig-patterns` skills in `docs/skills/` as principle checklists (colour, type, layout, accessibility, onboarding, loading, feedback, settings, destructive-action confirmation). They are written for native Apple apps: take the principles, not the native components. Look at every screen you change in a real browser, light and dark, narrow and wide, before you call it done.

## Implemented campaign hierarchy

Audience → waiting drafts → factual status → on-demand progress, lead entry, profiles and settings. Counts come from SQLite; never infer that the worker is online from campaign status. Screens must handle zero leads and zero drafts without sample activity. See [UI review](UI-REVIEW.md) for the HIG mapping, checks and limits.
