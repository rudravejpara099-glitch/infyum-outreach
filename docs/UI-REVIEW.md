# Campaign workspace: design and review

The owner approved liquid-glass depth, a fluid feel, a simpler campaign overview and removal of company branding from app chrome. This explicitly revises the original flat brand direction. The interface uses the plain label **Outreach**. Messaging identity in the outreach engine is unchanged.

## Screen job and reading order

The campaign screen answers who the campaign reaches, which drafts need a person, and what the saved campaign data says. Audience and review work come first. Stage counts, lead entry and settings expand on demand. A campaign's “Running” label describes its saved status; it is not proof that the worker is connected. Counts are real; no sample messages, successful actions or worker presence are invented.

## Skills applied

| Supplied reference and section | Implementation |
| --- | --- |
| `skills/hig-foundations/references/materials.md`, Liquid Glass / Standard materials | Glass navigation and controls float above quieter reading surfaces. More opaque surfaces keep draft text readable; reduced-transparency and no-blur fallbacks exist. |
| `skills/hig-foundations/references/layout.md`, Visual hierarchy / Adaptability | Audience → review queue → status → disclosures. One dominant review action. Mobile navigation exposes every destination. Tables and the pipeline scroll within their own containers. |
| `skills/hig-foundations/references/typography.md`, Ensuring legibility / Conveying hierarchy | Existing Jakarta/Inter fonts, restrained headings, visible field labels and aligned numbers. |
| `skills/hig-foundations/references/color.md`, Inclusive color; `dark-mode.md`, Dark Mode colors | Semantic theme tokens; statuses use text and form as well as colour. Light/dark/system preferences persist locally. |
| `skills/hig-foundations/references/accessibility.md`, Vision / Mobility / Speech | Visible keyboard focus, skip-to-content, labelled controls, semantic native disclosures and comfortable control sizes. |
| `skills/hig-foundations/references/motion.md`, Best practices / Providing feedback | Short, interruptible route/disclosure transitions and press feedback. No continuous movement; reduced-motion disables animation and smooth scrolling. |
| `skills/hig-patterns/SKILL.md`, Progressive disclosure; `references/settings.md`, Task-specific options | Audience and campaign settings remain in the campaign, expanded when needed. |
| `skills/hig-patterns/references/feedback.md`, Best practices; `entering-data.md`, Best practices | Pending submit state, explicit login errors with retained email/name, readable complete draft text and ordinary error/retry/loading surfaces. |

These are web adaptations of the supplied native principles. They are not claims to use Apple's native Liquid Glass renderer.

## Verification

- `npm test`: 58 tests. New integration tests cover empty summaries, campaign isolation, full counts versus preview limits, removal after approval, conversation-stage counts, and queues larger than 100 messages.
- `npm run typecheck` and `npm run lint`.
- `npx next build` and supported Webpack build path. The original native-loader/port failure was resolved by the standard Tailwind PostCSS integration.
- `npm run smoke:ui`: actual setup, sign out, login failure/retry, campaign creation, adding leads, campaign-scoped approval, updated count, invalid campaign filter, sign out and protected-route redirect. The test asserts that no outgoing message was sent.
- Campaign screenshots/checks at 1440, 1024 and 390px, light and dark. Shared Dashboard, Campaigns, New campaign, Pipeline, Approvals, Inbox, Accounts, Activity and Settings checked in both themes at 1440 and 390px; login checked at both widths/themes.
- Browser assertions cover no document overflow, complete draft text, visible keyboard focus, appearance persistence, system preference changes, and reduced-motion behaviour. Normal text, secondary text, link and primary-button token pairs are checked at 4.5:1 or better.
- Screenshot review caught and corrected the narrow teammate grid and cramped mobile approval drafts. The review uses disposable fixture data, separate from the owner's database.

## Still unverified

Live Instagram selectors/actions, a real Claude draft and real Apify results remain unverified. No worker, Instagram engagement/send or Apify run occurred. Error-boundary recovery under an actual database failure and the OS reduced-transparency setting have not been fault-injected/tested. Token contrast checks and Chromium layout checks are not a complete accessibility audit or Safari/Firefox test.

## Run the isolated review again

```sh
npm run smoke:ui
```

Uses local port 3190, its own temporary database and random in-memory credentials. The worker is never started. Database and browser session are cleaned up; screenshots remain under ignored `data/ui-smoke/`. Stop another Next development server in the same checkout before running it. Set `UI_SCREENSHOT_DIR` to choose another screenshot output folder.
