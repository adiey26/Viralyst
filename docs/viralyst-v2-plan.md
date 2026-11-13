# Viralyst v2: Creators and Business

**Status: proposal for review. Nothing here is built yet.**

Viralyst becomes one product with a **mode switch** at the top of the site, the audit form and every report:

> **For Creators** | **For Business**

Both modes run on the same engine (scraping, scoring, video analysis, AI, reports). The switch changes what is checked, how the score is weighted, which tools appear and how the report reads. A feature is only built once, even when both modes use it.

---

## 1. Who each mode is for

| | For Creators | For Business |
|---|---|---|
| **User** | An influencer, artist, coach or personal brand growing their own account | A brand, shop or agency auditing a company, often against competitors |
| **Main question** | "Why isn't my content growing, and what should I post next?" | "Why isn't Instagram bringing customers, and how do we beat competitors?" |
| **Success means** | Views, followers, saves, shares, brand deals | Enquiries, orders, sales, beating competitors |
| **Report tone** | Personal coach: "your hook", "your next Reel" | Consultant: "the brand", "the competition", "revenue" |
| **Main output** | Next-post guidance, scripts, media kit | Client-ready PDF, competitor benchmark, action plan |

---

## 2. Feature map

Legend: ✅ included · ⭐ main focus in that mode · – not shown in that mode

### Shared core (built once, used by both)

| Feature | Creator | Business | Notes |
|---|:-:|:-:|---|
| Public profile and post scraping (90 days) | ✅ | ✅ | Exists today |
| Viralyst Score with mode-specific weighting | ✅ | ✅ | One engine, two weightings (section 3) |
| **Second-by-second Reel analysis** (hook timing, drop-off moment, speech start, silences, pacing, ending) | ⭐ | ✅ | Upgrades today's 5-frame sampling |
| **Reel checker before posting** (upload a draft, get fixes, compare versions) | ⭐ | ✅ | Businesses use it for ad and product Reels |
| **Before-and-after tracking** (re-audit, "did it work?") | ✅ | ⭐ | Creators see their trend; businesses prove results to clients |
| **Best time to post** | ✅ | ✅ | From public post performance now; from follower activity once Instagram is connected |
| **Ask Viralyst** (chat about the account and the report) | ⭐ | ✅ | "Why did my Reel flop?" / "Why is the competitor ahead?" |
| **Content ideas and script builder** | ⭐ | ✅ | Creators: Reels in their voice. Businesses: product, offer and festival posts |
| Branded PDF report | ✅ | ⭐ | Creators get a personal report; businesses get the client report |
| **Instagram connection (official Meta login)** for private Insights | ✅ | ✅ | Fills reach, saves, retention, audience and best time automatically |
| **Automatic DM replies** (comment to DM, DM keyword, Story reply, Live) | ✅ | ✅ | Creators: lead magnets and links. Businesses: price and order enquiries |
| Trend signals in the niche | ⭐ | ✅ | From top posts in the niche and among competitors |

### Creator mode only

| Feature | What it does |
|---|---|
| **Creator Score** | Weighted towards hooks, reach beyond followers, saves and shares, consistency and niche clarity |
| **Media kit for brand deals** | A shareable one-page PDF: audience, reach, engagement, best content, rates field |
| **Brand pitch writer** | Drafts outreach messages to brands, using the creator's real numbers |
| **Growth plan** | A weekly posting plan with targets, updated after each re-audit |
| **Shoot plans** | Shot lists and talking points for the next filming day |
| **Similar creators to learn from** | Accounts in the same niche that are growing faster, with what they do differently |

### Business mode only

| Feature | What it does |
|---|---|
| **Competitor benchmark** (up to 5) | Exists today |
| **Sales and conversion checks** | Bio link, ordering path, tracking, Meta Pixel, buying-intent comments. Exists today |
| **Local competitor suggestions** | Finds competitors by location and category, so a Nepal shop isn't compared with Delhi |
| **Local business checks** | Google rating and reviews, ordering channels (WhatsApp, Zomato, Swiggy, website) |
| **Competitor ads** | Counts competitors' active Meta ads and shows their offers |
| **Agency workspace** | Many clients, each with their own reports and history |
| **Monthly progress report** | A recurring PDF comparing this month with the last audit |
| **White-label PDFs** | An agency's own logo on reports, for agencies reselling Viralyst |
| **Festival and season planner** | Shows what to post before Diwali, Dashain, Eid and so on, from past results |

### Not planned

| Feature | Why not |
|---|---|
| Native iOS and Android apps | Months of work. The website becomes installable on phones instead (a "progressive web app"), which covers most of the benefit |
| Posting and scheduling to Instagram | Needs extra Meta approval and is outside auditing. Can be added later |

---

## 3. How the score differs by mode

The 95-check framework stays. Each mode turns some checks on or off and changes the pillar weights.

| Pillar | Business weight | Creator weight | Change in Creator mode |
|---|:-:|:-:|---|
| 1. Profile and first impression | 8% | 8% | Bio judged for "who is this creator", not "what does this shop sell" |
| 2. Audience health | 8% | 10% | |
| 3. Content strategy | 10% | 12% | Niche clarity matters more |
| 4. Reels performance | 14% | 18% | |
| 5. Hooks and creative quality | 10% | 16% | Second-by-second analysis feeds this |
| 6. Carousels, posts and Stories | 8% | 8% | |
| 7. Engagement and community | 8% | 10% | |
| 8. Discoverability and search | 8% | 8% | |
| 9. Conversion and funnel | 10% | 2% | Mostly turned off; only link-in-bio stays |
| 10. Competitor benchmark | 6% | – | Replaced by "Similar creators" (4%) |
| 11. Paid and partnerships | 4% | 4% | Reframed as brand-deal readiness |
| 12. Account health and brand safety | 4% | – | Merged into pillar 11 |
| 13. Tracking and reporting setup | 2% | – | Not relevant for most creators |

These creator weights are a starting proposal for you to adjust.

---

## 4. What needs approvals, accounts or extra services

Some features can't be switched on by code alone.

| Needed for | Requirement | Who does it | Typical time |
|---|---|---|---|
| Almost all AI features (chat, scripts, Reel feedback, written reports) | A working Anthropic key with credit | You | Minutes |
| Instagram connection, private Insights, automatic DMs | A Meta developer app, business verification and **Meta App Review** for the Insights and messaging permissions | You submit; I build and prepare the review material | Often 1 to 4 weeks, sometimes longer |
| Automatic DMs, instant mini-audit, client logins | The app hosted online (for example Render) with a public HTTPS address | You create the account; I set it up | About an hour |
| Speech timing in uploaded Reels (when the voice starts, silences) | Nothing extra: measured from the audio track | – | – |
| Full transcripts of uploaded Reels (what is said) | A speech-to-text service (paid per minute) or a slower one run on your computer | Your choice | – |
| Local business checks (Google rating and reviews) | A Google Places key, which has a free tier and then charges per lookup | You | Minutes |
| Paid plans for creators | A payment provider such as Razorpay or Stripe, plus your business details | You | Days, for verification |

---

## 5. Build versions

Each version is usable on its own, and you can review it before the next one starts.

### v2.0: Two modes and deeper analysis (no outside approvals)
- Creators / Business switch on the website, audit form, reports and PDF
- Mode-specific scoring (section 3) and report wording
- Second-by-second Reel analysis for audited accounts
- Reel checker before posting (upload a draft)
- Before-and-after tracking and "did it work?"
- Best time to post (from public data)
- Ask Viralyst chat, content ideas and script builder *(needs a working Anthropic key)*
- Creator media kit and brand pitch writer
- Business: local competitor suggestions, performance by caption language, festival and season planner

### v2.1: Online, with accounts
- Hosted on Render
- Sign-up and login for creators; workspaces for agencies, with each client's reports kept separate
- Usage limits per account, so nobody can run up your Apify or Anthropic bill
- Instant free mini-audit on the website: handle in, quick score and one fix out
- Installable on phones (progressive web app)

### v2.2: Official Instagram connection (after Meta approval)
- "Connect Instagram" using Meta's official login
- Private Insights fill the 42 manual checks automatically
- Best time to post from real follower activity
- Automatic DM replies: comment to DM, DM keyword, Story reply, Live, inbox starters

### v2.3: Growth and money
- Paid plans and credits
- Trend signals for the niche
- Competitor ads tracking
- Google rating and reviews for local businesses
- Monthly progress reports and white-label PDFs for agencies

---

## 6. Decisions needed from you

1. **Do the creator score weights in section 3 look right?** They're a starting point.
2. **Should v2.0 start now**, with v2.1 to v2.3 following one at a time?
3. **For uploaded Reels, do you want full transcripts?** If so, choose a paid speech-to-text service or the slower free option on your computer.
4. **Payment provider** for v2.3: Razorpay, Stripe, or decide later.
5. **Will you start the Meta developer app and verification now?** It can take weeks, so starting early lets v2.2 follow sooner.
