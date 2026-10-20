# Design brief: how this app must look and behave

Goal: calm, fast, trustworthy. A tool people use all day, so information design beats decoration. It must not look like generic AI output.

## Direction
- Apple-style restraint (clarity, one accent colour, generous space, hairline borders) with Linear-style density (compact rows, keyboard-friendly, fast).
- Infyum brand: blue #188BF6 / #155EEF (accent), yellow #FFCB00 (highlight only), green #37CA37 (success), ink #222325. Headings Plus Jakarta Sans, text Inter.
- Tokens live in `app/globals.css` (`--bg --surface --ink --muted --line --accent --ok --warn --bad` and soft variants). Never hard-code a colour in a component.

## Rules
1. Light AND dark, both designed, both checked. Contrast at least WCAG AA (4.5:1 text).
2. Works from 390 px phone width to wide desktop. No horizontal page scroll; wide tables scroll inside their own container.
3. Show state with form, not only words: badges, pills, a stripe for what needs attention. Put the summary before the detail.
4. Every list has a designed empty state that says what will appear and what to do first. Every form shows what went wrong and how to fix it.
5. Every control has a visible keyboard focus. Respect reduced motion. Use real labels, not placeholders only.
6. One accent colour. Do not decorate every card the same way; reserve border, fill and shadow for the element that needs setting apart.
7. Avoid the generic-AI look: purple-to-blue gradients, emoji as section markers, everything centred, the same radius and shadow on everything, hero banners on a tool.
8. Copy: plain and specific, active voice, say what happens ("Approve and queue"). No filler, no apologies, no clever labels.
9. Numbers align (`tabular-nums`). Dates and times are shown in the team time zone.
10. Most-used screens (Pipeline board, Approvals, Inbox) get the most polish: fast scan, clear primary action, safe destructive actions.

## Process
Use the `hig-foundations` and `hig-patterns` skills in `docs/skills/` as principle checklists (colour, type, layout, accessibility, onboarding, loading, feedback, settings, destructive-action confirmation). They are written for native Apple apps: take the principles, not the native components. Look at every screen you change in a real browser, light and dark, narrow and wide, before you call it done.
