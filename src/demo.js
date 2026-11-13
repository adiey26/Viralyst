// Invented sample data, so the report can be seen without any keys. These are not real companies.
import { AI_CHECK_IDS } from './framework.js';
import { buildTimeline } from './frames.js';
import { reelFeedback } from './reelcheck.js';

/** A plausible measured Reel: quick hooks start sound and movement at once; slow ones open quietly and sag mid-way. */
function demoVideo(duration, quick) {
  const seconds = Math.round(duration);
  const gap = quick ? 2.5 : 8;
  const cuts = [];
  for (let t = gap; t < seconds; t += gap) cuts.push(Number(t.toFixed(1)));
  const motion = [];
  const loudness = [];
  const sagFrom = seconds * 0.45;
  const sagTo = sagFrom + 4;
  for (let t = 0; t < seconds; t += 0.2) {
    const nearCut = cuts.some((c) => Math.abs(c - t) < 0.4);
    const sag = !quick && t >= sagFrom && t < sagTo;
    motion.push({ t, v: nearCut ? 0.28 : sag ? 0.004 : quick ? 0.05 : 0.015 });
  }
  for (let t = 0; t < seconds; t += 0.5) {
    const silentStart = !quick && t < 1.8;
    const sag = !quick && t >= sagFrom && t < sagTo;
    loudness.push({ t, v: silentStart ? -60 : sag ? -42 : quick ? -18 : -24 });
  }
  const silences = quick ? [] : [{ from: 0, to: 1.8 }];
  const timeline = buildTimeline({ seconds, cuts, motion, loudness, silences, hasAudio: true });
  const stats = { width: 1080, height: 1920, isVertical: true, hasAudio: true, seconds, cuts: cuts.length, cutsPer10Seconds: Number(((cuts.length / seconds) * 10).toFixed(1)), ...timeline };
  return { ...stats, feedback: reelFeedback(stats) };
}

const DAY_MS = 86_400_000;

function randomSource(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const COMMENTS_GENERAL = ['Love this', 'So good', '🔥🔥🔥', '😍😍', 'Need to try this', 'Wow', 'Great video', '❤️', 'This is so true', 'Saving this one'];
const COMMENTS_BUYING = ['What is the price?', 'Do you deliver to Pune?', 'Where can I buy this?', 'Is this available online?', 'How much for the 250g bag?', 'Link please?', 'कितने का है?'];
const COMMENTS_HINDI = ['बहुत बढ़िया', 'मुझे भी चाहिए', 'कमाल का है भाई', 'क्या बात है', 'सुबह की शुरुआत ऐसे ही होनी चाहिए'];
const COMMENTS_ARABIC = ['رائع جدا', 'أريد تجربة هذا'];

const A_CONCEPTS = [
  ['Our story began in a small roastery. Take a look behind our brand.', 75],
  ['Celebrating another wonderful year with our amazing team and customers.', 68],
  ['Introducing our new seasonal collection, crafted with care for you.', 52],
  ['A peaceful morning at the cafe. Come and visit us this weekend.', 44],
  ['Our founder shares the values that shape everything we do.', 88],
  ['Thank you to everyone who joined our community event last month.', 61],
  ['3 mistakes ruining your morning coffee? Number 2 surprised our own baristas.', 21],
  ['Why does cafe coffee taste better than yours? Here is the real reason.', 18],
];

const B_CONCEPTS = [
  ['Stop adding milk first. Here is what it does to your coffee.', 14],
  ['Is expensive coffee actually better? We tested 5 brands blind.', 24],
  ['₹20 hack that makes instant coffee taste like a cafe. Comment RECIPE for the steps.', 12],
  ['Your coffee is bitter for one reason. Watch this before you brew tomorrow.', 17],
  ['We asked 100 people in Mumbai to spot the fake filter coffee.', 28],
  ['POV: you finally tried the right water temperature.', 11],
  ['What 1 week of cold brew did to our sales team. Link in bio for the kit.', 33],
  ['Our new bag launch, now available in all stores.', 46],
];

function buildPosts(prefix, concepts, base, spread, rand, now, { likeRate, commentRate, buyShare, regional }) {
  const reels = [];
  for (let i = 0; i < 28; i += 1) {
    const [caption, duration] = concepts[i % concepts.length];
    const ageDays = 3 + i * 2.1 + rand();
    const hookBoost = duration < 30 ? 1.9 : 0.8;
    const views = Math.round(base * hookBoost * (0.55 + rand() * spread) ** 2);
    const hour = 7 + Math.floor(rand() * 14);
    const when = new Date(now - ageDays * DAY_MS);
    when.setUTCHours(hour, 15, 0, 0);
    const comments = [];
    const sampleSize = 25;
    for (let c = 0; c < sampleSize; c += 1) {
      const roll = rand();
      if (roll < buyShare) comments.push(COMMENTS_BUYING[Math.floor(rand() * COMMENTS_BUYING.length)]);
      else if (roll < buyShare + regional) comments.push(COMMENTS_HINDI[Math.floor(rand() * COMMENTS_HINDI.length)]);
      else if (roll < buyShare + regional + 0.03) comments.push(COMMENTS_ARABIC[Math.floor(rand() * COMMENTS_ARABIC.length)]);
      else comments.push(COMMENTS_GENERAL[Math.floor(rand() * COMMENTS_GENERAL.length)]);
    }
    reels.push({
      shortCode: `${prefix}${String(i).padStart(3, '0')}`,
      url: 'https://www.instagram.com/',
      type: i % 9 === 8 ? 'carousel' : 'reel',
      caption: `${caption}\n\n#coffee #india${i % 3 === 0 ? ' #mumbai' : ''}`,
      hashtags: ['coffee', 'india', ...(i % 3 === 0 ? ['mumbai'] : [])],
      mentions: [],
      likes: Math.round(views * likeRate * (0.7 + rand() * 0.6)),
      comments: Math.round(views * commentRate * (0.6 + rand() * 0.8)),
      views: i % 9 === 8 ? null : views,
      duration: i % 9 === 8 ? null : duration,
      timestamp: when.toISOString(),
      location: i % 5 === 0 ? 'Mumbai, Maharashtra' : null,
      thumbUrl: null,
      isPinned: false,
      slides: i % 9 === 8 ? 5 : 0,
      alt: i % 4 === 0 ? 'Barista pouring coffee at the counter' : null,
      taggedUsers: i % 7 === 0 ? ['sample_creator'] : [],
      coauthors: [],
      music: i % 9 === 8 ? null : { artist: null, song: null, isOriginal: i % 2 === 0, muted: false },
      shares: null,
      video: i % 9 === 8 ? null : demoVideo(duration, duration < 30),
      transcript: null,
      commentSample: comments,
      inLatest: i < 12,
    });
  }
  return reels;
}

function buildHistory(endFollowers, dailyGain, rand, posts, now, spikeBoost) {
  const days = 30;
  const topPosts = [...posts].filter((post) => post.views).sort((x, y) => y.views - x.views).slice(0, 2);
  const gains = Array.from({ length: days - 1 }, () => Math.round(dailyGain * (0.7 + rand() * 0.6)));
  for (const post of topPosts) {
    const daysAgo = Math.floor((now - new Date(post.timestamp).getTime()) / DAY_MS) - 1;
    const index = gains.length - 1 - daysAgo;
    if (index >= 0 && index < gains.length) gains[index] += spikeBoost;
  }
  let followers = endFollowers - gains.reduce((sum, gain) => sum + gain, 0);
  const history = [];
  for (let i = 0; i < days; i += 1) {
    history.push({ takenAt: new Date(now - (days - 1 - i) * DAY_MS).toISOString(), followers });
    followers += gains[i] ?? 0;
  }
  return history;
}

export function demoAccounts(now = Date.now()) {
  const randA = randomSource(11);
  const randB = randomSource(29);
  const postsA = buildPosts('DEMOA', A_CONCEPTS, 21000, 1.1, randA, now, { likeRate: 0.034, commentRate: 0.0011, buyShare: 0.05, regional: 0.08 });
  const postsB = buildPosts('DEMOB', B_CONCEPTS, 16000, 1.5, randB, now, { likeRate: 0.052, commentRate: 0.0034, buyShare: 0.21, regional: 0.24 });
  const randC = randomSource(47);
  const postsC = buildPosts('DEMOC', A_CONCEPTS, 9000, 1.3, randC, now, { likeRate: 0.041, commentRate: 0.0018, buyShare: 0.11, regional: 0.15 });
  const page = (over) => ({
    present: true, ok: true, status: 200, startUrl: 'https://example.com/', finalUrl: 'https://example.com/', hops: 0, responseMs: 900, https: true,
    isLinkPage: false, hasUtm: false, title: 'Sample page', description: null, hasViewport: true, hasMetaPixel: false, hasAnalytics: false, hasTagManager: false,
    hasCheckout: true, hasLeadCapture: false, text: 'Sample landing page text.', ...over,
  });

  return [
    {
      profile: {
        handle: 'demo_lane_coffee', fullName: 'Lane Coffee (sample)', bio: 'Premium coffee. Crafted with passion. Since 2016.',
        followers: 84200, following: 910, postsCount: 1120, highlights: 3, isBusiness: true, category: 'Coffee Shop',
        verified: false, externalUrl: null, country: null, url: 'https://www.instagram.com/',
      },
      posts: postsA,
      history: buildHistory(84200, 14, randA, postsA, now, 60),
      landing: { present: false },
    },
    {
      profile: {
        handle: 'demo_roast_theory', fullName: 'Roast Theory (sample)', bio: 'Better coffee at home in 5 minutes ☕\nFree shipping across India 🇮🇳\n👇 Shop the starter kit',
        followers: 61500, following: 220, postsCount: 640, highlights: 8, isBusiness: true, category: 'Food & Beverage',
        verified: false, externalUrl: 'https://example.com/', country: null, url: 'https://www.instagram.com/',
      },
      posts: postsB,
      history: buildHistory(61500, 42, randB, postsB, now, 900),
      landing: page({ hasUtm: true, hasMetaPixel: true, hasAnalytics: true }),
    },
    {
      profile: {
        handle: 'demo_bean_bureau', fullName: 'Bean Bureau (sample)', bio: 'Small-batch beans, delivered monthly.\nSubscribe below.',
        followers: 37800, following: 410, postsCount: 390, highlights: 5, isBusiness: true, category: 'Food & Beverage',
        verified: false, externalUrl: 'https://example.com/', country: null, url: 'https://www.instagram.com/',
      },
      posts: postsC,
      history: buildHistory(37800, 22, randC, postsC, now, 300),
      landing: page({ isLinkPage: true, hasAnalytics: true }),
    },
  ];
}

export const demoInsightsNote = 'In a real audit, enter private Insights in the scorecard to raise coverage. This sample has none entered.';

const SAMPLE_FIXES = [
  ['Add a shop link to the bio.', 'New visitors have no next step.', 'Add the link today, with UTM tags.', '1.5', 'high', 'low'],
  ['Rewrite the bio around the customer.', 'It describes the brand, not the benefit.', 'Use the suggested bio below.', '1.3', 'high', 'low'],
  ['Open every Reel with a problem or test.', 'This is the clearest gap between winners and losers.', 'Rewrite the first line of your next three Reels.', '5.2', 'high', 'medium'],
  ['Keep most Reels under 30 seconds.', 'Your longest Reels sit below your typical post.', 'Recut your best founder video into three 20-second tips.', '5.4', 'high', 'medium'],
  ['Add one comment keyword to each Reel.', 'It shows who is interested.', 'Choose a keyword for your next three posts.', '9.4', 'medium', 'low'],
  ['Build Highlights for Reviews, Prices and Delivery.', 'They answer buyer questions.', 'Create the Prices Highlight first.', '1.6', 'medium', 'low'],
  ['Turn winning hooks into named series.', 'Series are easy to produce and recognise.', 'Name one series and plan four episodes.', '3.5', 'medium', 'medium'],
  ['Run one collab a month.', 'Few posts reach a partner audience.', 'List five creators and message two.', '8.5', 'medium', 'medium'],
  ['Show real customers.', 'Competitors do not own this yet.', 'Ask three customers for a short clip.', '7.7', 'medium', 'medium'],
  ['Add a Meta Pixel and analytics.', 'Sales cannot be traced to Instagram yet.', 'Confirm what is already installed.', '13.2', 'medium', 'medium'],
].map(([fix, why, first_step, checkpoint_id, impact, effort]) => ({ fix, why, first_step, checkpoint_id, impact, effort }));

function sampleCheckpoints(account, win, lose) {
  const unseen = new Set(['3.7']);
  return AI_CHECK_IDS.map((id, i) => {
    if (unseen.has(id)) {
      return { id, can_assess: false, score: 0, finding: 'Sample: there is not enough material to judge this.', evidence: '', fix: '', confidence: 'low', post_refs: [] };
    }
    return {
      id,
      can_assess: true,
      score: [52, 68, 41, 74, 35, 60, 47, 82][i % 8],
      finding: `Sample finding for this checkpoint on @${account.profile.handle}.`,
      evidence: 'Sample evidence. A real audit cites posts and numbers here.',
      fix: 'Sample fix. A real audit gives a specific next step here.',
      confidence: 'medium',
      post_refs: i % 2 ? [win] : [lose],
    };
  });
}

/** Sample text showing what the AI section looks like. Its figures come from the sample metrics. */
export function demoAnalysis(report) {
  const [a, b] = report.accounts;
  const aHandle = a.profile.handle;
  const bHandle = b.profile.handle;
  const aWin = a.metrics.winners[0];
  const aLose = a.metrics.losers[0];
  const bWin = b.metrics.winners[0];
  const bWin2 = b.metrics.winners[1];
  const bLaunches = b.posts.filter((post) => post.perf != null && post.caption.startsWith('Our new bag')).sort((x, y) => x.perf - y.perf);
  const bLose = bLaunches[0]?.shortCode ?? b.metrics.losers[0];
  const views = (m) => Math.round(m.medianViews).toLocaleString('en-US');
  const short = (bucket) => bucket.breakdowns.duration[1].value?.toFixed(1) ?? 'n/a';
  const long = (bucket) => bucket.breakdowns.duration[3].value?.toFixed(1) ?? 'n/a';

  return {
    headline: `@${bHandle} gets more views from fewer followers because its Reels open with a problem, not the brand.`,
    summary: `This sample text shows the format of the AI section. @${bHandle} has fewer followers than @${aHandle}, yet its typical Reel reaches ${views(b.metrics)} views against ${views(a.metrics)}. Its comments also show more purchase questions. @${aHandle} does best when it copies this approach, which it rarely does.`,
    accounts: [
      {
        handle: aHandle,
        working: [
          { claim: 'Problem-led short Reels are its top performers.', evidence: `Reels of 15 to 30 seconds reach ${short(a.metrics)}× its typical post.`, post_refs: [aWin], kind: 'observed', confidence: 'medium' },
          { claim: 'They probably work because viewers immediately see a problem of their own.', evidence: 'Winning hooks name a mistake or ask a question in the first line.', post_refs: [aWin], kind: 'hypothesis', confidence: 'medium' },
        ],
        not_working: [
          { claim: 'Long brand story videos underperform.', evidence: `Reels over 60 seconds reach ${long(a.metrics)}× its typical post.`, post_refs: [aLose], kind: 'observed', confidence: 'high' },
          { claim: 'They likely lose viewers because they begin with the company rather than the viewer.', evidence: 'Its lowest posts open with phrases such as "our story" and "celebrating".', post_refs: [aLose], kind: 'hypothesis', confidence: 'medium' },
        ],
        business_fit: { assessment: 'Attention is mostly friendly rather than commercial.', evidence: `Only ${a.audience.intent.buyingIntent} of ${a.audience.intent.sampled} sampled comments ask about price, delivery or buying.` },
        audience_read: { summary: 'The clues lean towards urban India, based on Mumbai tags and some Hindi comments. Treat this as a direction, not a measurement.', confidence: 'low' },
      },
      {
        handle: bHandle,
        working: [
          { claim: 'It uses a repeatable format: a sharp claim, then a quick demonstration.', evidence: 'Its winners open with a direct problem or test and are mostly under 30 seconds.', post_refs: [bWin, bWin2], kind: 'observed', confidence: 'high' },
          { claim: 'Comment prompts likely help it find buyers.', evidence: 'Calls such as "Comment RECIPE" invite a response tied to a next step.', post_refs: [bWin], kind: 'hypothesis', confidence: 'medium' },
        ],
        not_working: [
          { claim: 'Plain launch announcements fall flat, even for this account.', evidence: 'Its launch post drops the problem-led hook and sits below its typical post.', post_refs: [bLose], kind: 'observed', confidence: 'medium' },
        ],
        business_fit: { assessment: 'Its content attracts people close to buying.', evidence: `${b.audience.intent.buyingIntent} of ${b.audience.intent.sampled} sampled comments ask about price, delivery or buying.` },
        audience_read: { summary: 'The clues lean towards India, with more Hindi comments than @' + aHandle + '. Treat this as a direction, not a measurement.', confidence: 'medium' },
      },
    ],
    why_the_leader_leads: [
      { claim: `@${bHandle} wins on reach per follower, not audience size.`, evidence: 'See Reel views per follower in the scoreboard.', post_refs: [], kind: 'observed', confidence: 'high' },
      { claim: 'Its hook-first structure likely earns longer watch time, which would help Reels spread.', evidence: 'Watch time is not public, so this is inferred from short durations and strong view counts.', post_refs: [bWin], kind: 'hypothesis', confidence: 'medium' },
    ],
    a_should_copy_from_b: [
      { move: 'Open every Reel with a specific problem or test.', why: 'This is the clearest difference between winners and losers on both accounts.', post_refs: [bWin] },
      { move: 'Use one comment keyword as the call to action.', why: 'It turns viewers into a visible list of interested people.', post_refs: [bWin] },
    ],
    competitor_notes: report.accounts.slice(1).map((account) => ({
      handle: account.profile.handle,
      positioning: account.profile.bio.split('\n')[0],
      offers_and_cues: account.landing?.hasCheckout ? 'Sample: sells directly from its bio link.' : 'Sample: no clear offer on the profile.',
      what_works: 'Sample: its best Reels open with a problem or a test.',
      weakness: 'Sample: plain announcements fall flat, and few posts show real customers.',
      post_refs: account.metrics.winners.slice(0, 1),
    })),
    gaps_neither_fills: [
      { gap: 'Regional-language Reels', why_it_matters: 'Hindi comments appear on both accounts, yet neither account captions in Hindi.' },
      { gap: 'Customer proof', why_it_matters: 'Neither account regularly shows real customers, which would answer doubts close to purchase.' },
    ],
    checkpoints: sampleCheckpoints(a, aWin, aLose),
    top_10_fixes: SAMPLE_FIXES,
    content_teardown: [
      ...a.metrics.winners.slice(0, 2).map((ref) => ({ ref, verdict: 'best', hook: 'Sample: names a mistake the viewer may be making.', pacing: 'Sample: about 4 cuts per 10 seconds.', likely_drop_off: 'Sample: confirm in Insights. Probably after the first tip.', what_to_change: 'Sample: end with one comment keyword.' })),
      ...a.metrics.losers.slice(0, 2).map((ref) => ({ ref, verdict: 'worst', hook: 'Sample: opens with the brand rather than the viewer.', pacing: 'Sample: about 1 cut per 10 seconds.', likely_drop_off: 'Sample: confirm in Insights. Probably within 3 seconds.', what_to_change: 'Sample: recut to 20 seconds and open with the most useful line.' })),
    ],
    profile_rewrite: {
      name_field: 'Lane Coffee | Fresh roasted coffee',
      bio: 'Fresh roasted coffee for better mornings at home\n[add proof, such as customers served]\nDelivery across India\nShop your first bag below',
      highlights: [{ title: 'Reviews', purpose: 'Show real customer proof.' }, { title: 'Prices', purpose: 'Answer the most common question.' }, { title: 'Delivery', purpose: 'Remove doubts before buying.' }],
      pinned_posts: [{ purpose: 'Introduce', idea: 'Who you are and who the coffee is for, in 20 seconds.' }, { purpose: 'Prove', idea: 'A customer reaction or blind taste test.' }, { purpose: 'Sell', idea: 'Your best-selling bag and how to order.' }],
    },
    plan_30_60_90: [
      { period: 'Days 1–30', focus: 'Fix the profile and test hooks.', content_pillars: ['Brewing mistakes', 'Taste tests', 'Behind the roast'], posting_rhythm: '3 Reels and 1 carousel each week', formats: ['Reels under 30 seconds', 'Carousels'], targets: ['Sample: add a shop link', 'Sample: typical Reel views up 25%'] },
      { period: 'Days 31–60', focus: 'Repeat the winners as named series.', content_pillars: ['Brewing mistakes', 'Taste tests', 'Customer stories'], posting_rhythm: '4 Reels and 1 carousel each week', formats: ['Reels', 'Carousels', 'Collab posts'], targets: ['Sample: one collab each month', 'Sample: more comments asking to buy'] },
      { period: 'Days 61–90', focus: 'Turn attention into sales.', content_pillars: ['Taste tests', 'Customer stories', 'Offers'], posting_rhythm: '4 Reels, 1 carousel and daily Stories', formats: ['Reels', 'Carousels', 'Stories'], targets: ['Sample: UTM tags on every link', 'Sample: run your best Reel as an ad'] },
    ],
    post_ideas_for_a: [
      { title: 'Blind taste test', hook: 'Can your barista spot our coffee blindfolded?', format: 'Reel, 20 seconds', why: 'It adapts the test format that works for the competitor.', based_on_refs: [bWin] },
      { title: 'One brewing fix', hook: 'Your morning coffee is bitter for one reason.', format: 'Reel, 15 seconds', why: 'It builds on the mistake-led format of your own best Reel.', based_on_refs: [aWin] },
    ],
  };
}
