# Go-live: from "built" to "running"

Do these in order. Each step says how you know it worked. `npm run ready` (step 4) tells you in plain words what is still missing, at any time.

## What you need first (all free except Claude and Apify)

| What | Where to get it | Goes in `.env.local` as |
|---|---|---|
| Claude key, with a few dollars of credit on the account | console.anthropic.com, API keys | `ANTHROPIC_API_KEY=` |
| Apify token | console.apify.com, Settings, API and Integrations | `APIFY_TOKEN=` |
| Google client id and secret | Google Cloud, Credentials, OAuth client "Web application" | `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=` |

In Google Cloud, on that client: add **both** redirect addresses `http://localhost:3000/api/auth/google/callback` and `http://localhost:3000/api/sheets/google/callback`, and turn on the **Google Sheets API** for the project.

## Steps

1. **Paste the keys.** Open `.env.local` (in the project folder). The four lines are already there, empty. Paste each key after the `=` and save. Nothing else to edit.
2. **Switch on paid work (spends nothing).** In a terminal in the project folder:
   ```
   npm run setup:claude -- --limit 10 --apify-cap 5 --pause-campaigns --yes
   ```
   `10` is the most you are happy to spend a month on Claude and Apify together; `5` is the Apify part. Change the numbers if you like. Without `--yes` it only shows what it would do.
3. **Restart the app so it reads the keys.**
   ```
   npm run restart
   ```
4. **Check.**
   ```
   npm run ready
   ```
   It tests the Claude key and the Apify token with free calls and prints OK, NOTE or TODO for everything. Fix each TODO using the line under it. NOTE lines are just things to know.
5. **Connect the Google Sheet.** In the app: Settings, **Google Sheet**, **Connect Google Sheets**, allow, then **Create the Sheet**. Within a minute the Sheet fills in.
6. **Open Chrome.** The extension reconnects by itself within about 15 seconds. First time on a new Mac: `chrome://extensions`, Developer mode, Load unpacked, pick the `extension` folder, then Accounts, Connect your Chrome (see `docs/APP-SETUP.md`).
7. **Start small, on a spare account.** Press **Resume** at the top of the app, start the campaign, and run Find leads, then Engage, then Send DMs on 2 or 3 leads. **Every message waits for your approval** in Review messages. Read each one before approving.

## Safety rules that matter

- Instagram locked the test account when the app ran with no pauses. Pauses are on; leave them on.
- Use a spare or well-used Instagram account, not one with no posts and a handful of followers.
- The daily cap is 5 for the first week. Do not raise it quickly.
- **Stop everything** (top of the app) stops all jobs and the extension at once.
- Check a message arrived by looking in Instagram's chat, not only in the app.

## If something is off

| What you see | What to do |
|---|---|
| `npm run ready` says the Claude key is refused | Copy the key again from console.anthropic.com. |
| A draft fails with a billing error | Add credit at console.anthropic.com. |
| Find leads does nothing | Apify limit not set (step 2) or token missing; `npm run ready` says which. |
| The app looks old after a change | `npm run restart` (it stops the old server properly first). |
| Instagram shows a lock or security page | Stop everything. Recover the account yourself. Do not run again the same day. |
| The extension is offline | Open Chrome. If it never connects, redo step 6. |
