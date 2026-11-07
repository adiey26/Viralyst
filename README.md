# Insta Audit

Runs the Viralyst Instagram Audit Framework on a company and up to 5 competitors: 13 weighted pillars, 95 checkpoints and one Viralyst Score, with the written deliverables.

## Start it

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:4173. **View sample report** works straight away with invented data.

## Connect real accounts

Paste these into the **Connect your keys** box in the app and press **Save keys**. No restart is needed.

- **Apify token** from [Apify](https://console.apify.com/settings/integrations). This fetches public Instagram data.
- **Anthropic API key** from the [Claude Console](https://platform.claude.com/settings/keys). This writes the "why it works" analysis.

The keys are saved in a `.env` file in this folder. You can also create that file yourself from `.env.example`, then restart the app.

Without the Anthropic key you still get every number and chart, just no written analysis.

## How the 95 checkpoints get their answers

| Source | Checkpoints | Examples |
|---|---:|---|
| Measured from public data | 27 | Engagement, cadence, format mix, hashtags, bio link, competitor ranks |
| Judged by AI from public material | 32 | Bio, hooks, first frames, content pillars, brand voice, sentiment |
| Entered by you from Insights or the client | 36 | Skip rate, retention, saves, Highlights, Stories, DMs, ads, Account Status, security |

Some measured and AI checkpoints can only be partly assessed from public data. Each one states its limit in the scorecard, and you can replace the result with your own rating.

The Viralyst Score leaves out anything without data and shows how many checkpoints it rests on. It stays provisional until the private checkpoints are entered.

Scoring bands in `src/framework.js` and `src/checks.js` are starting assumptions, not published benchmarks. Adjust them to Viralyst's own standards.

## What an audit costs

These are rough figures, and each provider's current pricing applies.

- **Apify:** roughly $0.40 to $0.70 per company, depending on how much it posted in 90 days, so a free plan's $5 a month covers about one or two full audits with 5 competitors. `APIFY_MAX_USD_PER_RUN` caps each scraper run.
- **Claude:** needs credit on your Anthropic account, which the tool checks before scraping. The cost depends on the number of posts and images. Each report shows the estimated cost in its data notes.

## What the AI reviews

Claude sees covers, the profile photo, and 5 sampled frames from up to 5 of the company's Reels, plus 3 frames from up to 2 Reels per competitor. It reads captions, sampled comments and bio link text. This is sampled frames, not every frame.

Set `INCLUDE_TRANSCRIPTS=true` to add what is said in Reels, which Apify charges for per minute of audio. Set `INCLUDE_SHARES=true` to add public share counts, which needs a paid Apify plan. The field names for transcripts and shares have not been confirmed on a real run.

Video analysis uses FFmpeg through `ffmpeg-static`, which is GPL-licensed. Review that if you plan to redistribute this software.

## Follower tracking

Tracking begins the first time you audit an account and cannot look back. It needs 7 days of readings before it looks for jumps.

The app takes a reading about once a day while it is open. To keep tracking while it is closed, schedule this command to run daily:

```bash
npm run snapshot
```

## Data and terms

Instagram's terms restrict automated collection, so review that risk before using this commercially or at scale, and only analyse public accounts. Scrapers can also stop working when Instagram changes.

Reports and follower history are stored in the `data` folder on this computer. Commenter usernames are not saved, though comment text is.

## Put it online with GitHub and Render

GitHub stores the code. Render runs it. Every time you push to GitHub, Render updates the site.

### 1. Upload the code to a private GitHub repository

1. On github.com, create a new repository. Choose **Private** and leave every "Add a README / .gitignore / license" box unticked.
2. In this folder, connect it and push, replacing the address with your repository's:

```bash
git remote add origin https://github.com/YOUR-NAME/viralyst-insta-audit.git
```

```bash
git push -u origin main
```

Git opens a GitHub sign-in window the first time. Your `.env` keys, `data` folder, PDFs and Word files are never uploaded.

### 2. Create the site on Render

1. Sign up at render.com and connect your GitHub account.
2. Choose **New → Blueprint** and pick the repository. Render reads `render.yaml`.
3. Fill in the three secrets when asked:
   - `APP_PASSWORD`: the password your team will use to sign in. Use a long one.
   - `APIFY_TOKEN`: your Apify token.
   - `ANTHROPIC_API_KEY`: your Anthropic key.
4. Approve the plan. The **Starter** plan is needed for the disk that keeps reports and follower tracking. Check Render's current pricing before you approve.
5. When the deploy finishes, open the `onrender.com` address Render shows and sign in.

### Hosted mode

- Everyone must sign in with `APP_PASSWORD`. The app refuses to start online without one.
- Keys are changed in Render under **Environment**, not in the app's Settings page.
- Audits run on Render's servers, using your Apify and Anthropic credit.
- To use your own domain, add it in Render and include it in an `ALLOWED_HOSTS` setting, separated by commas.

## Tests

```bash
npm test
```
