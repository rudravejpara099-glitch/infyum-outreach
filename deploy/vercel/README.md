# Vercel front door

The public website address. Vercel serves nothing itself: every request is forwarded to the Outreach app
running on the always-on Mac, through a Cloudflare tunnel. The database, the background worker and the
local AI model stay on that Mac, because Vercel cannot keep files, run a worker or drive Chrome.

- Vercel project root directory: `deploy/vercel`.
- `vercel.json` holds the tunnel address. A free quick tunnel gets a new address when it restarts
  (`cloudflared tunnel --url http://localhost:3000` on the Mac). Put the new address in `vercel.json`
  and merge to `main`; Vercel redeploys on its own.
- Starting Outreach and opening Instagram sign-in windows work only from the Mac itself, never through this address.
