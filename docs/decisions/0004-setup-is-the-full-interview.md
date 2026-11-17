# 0004: The kit's setup is the full interview, and it is not changed without the owner

Date: 2026-11-17 · Status: decided by the owner

## Context
On 16 Nov the setup was built as a full client interview in grill-me layout (PRs #97, #98), then swapped for a 3-question quick setup (#99), then restored to the interview on 17 Nov (#110), briefly put back to quick (#111), and restored again. The back and forth cost a day.

## Decision
The setup is the **full interview**: Round 1 asks "INFYUM team, or your own business?"; then the whole set of questions in numbered rounds with a recommended answer under each (name, niche, audience, problem, who to skip, spare or established account, how many profiles, full run or part); then Instagram sign-in, Apify, Google Sheets and the work. Claude never asks what it can look up itself (Instagram account, bio link, the team Sheet).

## Rule
No session changes the setup sequence or its questions without the owner saying so in that session. Record any change here and in `docs/kit-changelog.md` (`npm run kit:lock`).
