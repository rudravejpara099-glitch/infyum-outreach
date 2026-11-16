---
paths:
  - "app/**"
  - "components/**"
---

# UI rules (app/, components/)

- Read `docs/DESIGN.md` first. Apply the checklists in `docs/skills/hig-foundations/` and `docs/skills/hig-patterns/`.
- Colours come from the tokens in `app/globals.css` (`--bg --surface --ink --muted --line --accent --ok --warn --bad`). Never hard-code a colour in a component.
- Design and check **both** light and dark. Text contrast at least WCAG AA (4.5:1).
- Every server action and page calls `requireUser()` (`lib/auth/dal.ts`) first. Do not rely on `proxy.ts` for security.
- This is Next.js 16: `proxy.ts` replaces middleware, `params`, `searchParams` and `cookies()` are async, `cacheComponents` is off on purpose (pages are `force-dynamic`). Run `npx next typegen` after adding routes. Docs are in `node_modules/next/dist/docs/`.
- Screens never contain business rules. Rules live in `lib/domain/`; the screen only shows their result.
- After a UI change run `npm run smoke:ui`. It uses a temporary database and never touches real data.
