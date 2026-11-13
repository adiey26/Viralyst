import { dominantScript } from './audience.js';

const DAY_MS = 86_400_000;
const NEW_POST_MS = 2 * DAY_MS; // Posts younger than this are still gathering views.
export const MIN_SAMPLE = 3;

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const isMoving = (post) => post.type === 'reel' || post.type === 'video';
const engagement = (post) => (post.likes == null || post.comments == null ? null : post.likes + post.comments);
const time = (post) => new Date(post.timestamp).getTime();

const CTA = /\b(comment|link in bio|follow|dm|save this|share|shop|buy|order|book|tag a|sign up|download|visit|click)\b/i;

export function hookOf(caption) {
  const firstLine = (caption ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  return firstLine.slice(0, 160);
}

/**
 * Adds perf (how a post did against the account's own norm, where 1 = typical) to each post.
 * Moving and static posts have separate baselines because static posts have no public views.
 * Pinned and very new posts are left out, since their numbers aren't comparable.
 */
export function scorePosts(posts, now = Date.now()) {
  const eligible = (p) => p.timestamp && !p.isPinned && now - time(p) >= NEW_POST_MS;
  const moving = posts.filter((p) => eligible(p) && isMoving(p) && p.views != null);
  const still = posts.filter((p) => eligible(p) && !(isMoving(p) && p.views != null) && engagement(p) != null);
  const viewBase = moving.length >= MIN_SAMPLE ? median(moving.map((p) => p.views)) : null;
  const stillBase = still.length >= MIN_SAMPLE ? median(still.map(engagement)) : null;

  return posts.map((post) => {
    let perf = null;
    let perfBasis = null;
    if (eligible(post)) {
      if (isMoving(post) && post.views != null) {
        if (viewBase) { perf = post.views / viewBase; perfBasis = 'views'; }
      } else if (engagement(post) != null && stillBase) {
        perf = engagement(post) / stillBase;
        perfBasis = 'likes and comments';
      }
    }
    return { ...post, perf, perfBasis, hook: hookOf(post.caption) };
  });
}

function bucketize(posts, keyOf, order, valueOf = (p) => p.perf) {
  const groups = new Map(order.map((label) => [label, []]));
  for (const post of posts) {
    const key = keyOf(post);
    if (groups.has(key)) groups.get(key).push(post);
  }
  return order.map((label) => {
    const values = groups.get(label).map(valueOf).filter(Number.isFinite);
    return { label, n: values.length, value: median(values), lowSample: values.length < MIN_SAMPLE };
  });
}

const durationBucket = (p) => {
  if (p.duration == null) return null;
  if (p.duration < 15) return 'Under 15s';
  if (p.duration < 30) return '15–30s';
  if (p.duration < 60) return '30–60s';
  return 'Over 60s';
};

const captionBucket = (p) => {
  const length = p.caption.length;
  if (length < 80) return 'Short (under 80)';
  if (length < 300) return 'Medium (80–300)';
  return 'Long (over 300)';
};

function localParts(post, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: 'numeric', hour12: false })
    .formatToParts(new Date(post.timestamp));
  return {
    weekday: parts.find((part) => part.type === 'weekday').value,
    hour: Number(parts.find((part) => part.type === 'hour').value) % 24,
  };
}

const timeBucket = (hour) => {
  if (hour < 6) return 'Night (0–6)';
  if (hour < 12) return 'Morning (6–12)';
  if (hour < 17) return 'Afternoon (12–17)';
  if (hour < 21) return 'Evening (17–21)';
  return 'Late (21–24)';
};

const FORMATS = { reel: 'Reel', video: 'Video', carousel: 'Carousel', image: 'Image' };

function cadence(feed) {
  const times = feed.map(time).sort((a, b) => a - b);
  if (times.length < 2) return { postsPerWeek: null, longestGapDays: null, spanDays: null };
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS);
  const spanDays = (times.at(-1) - times[0]) / DAY_MS;
  return {
    postsPerWeek: spanDays > 0 ? ((times.length - 1) / spanDays) * 7 : null,
    longestGapDays: Math.max(...gaps),
    spanDays,
  };
}

/** Older posts added for pattern-finding mean the window is fully known, so cadence is simply posts ÷ weeks. */
function windowCadence(feed, reviewDays, now) {
  const inWindow = feed.filter((post) => post.inWindow !== false);
  const hasOlderPosts = inWindow.length < feed.length;
  const result = cadence(inWindow);
  if (!hasOlderPosts) return result;
  const times = inWindow.map(time).sort((a, b) => a - b);
  const sinceLastPost = times.length ? (now - times.at(-1)) / DAY_MS : reviewDays;
  return {
    ...result,
    postsPerWeek: inWindow.length / (reviewDays / 7),
    longestGapDays: Math.max(result.longestGapDays ?? 0, sinceLastPost),
    spanDays: reviewDays,
  };
}

const SLOTS = ['Morning (6–12)', 'Afternoon (12–17)', 'Evening (17–21)', 'Late (21–24)', 'Night (0–6)'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * When posts did best, by day and time of day. This uses public post results, so it shows when the
 * account's posts have worked, not when followers are online (that needs Instagram's own data).
 */
export function bestPostingTimes(scored, timezone) {
  const cells = new Map();
  for (const post of scored) {
    const { weekday, hour } = localParts(post, timezone);
    const key = `${weekday}|${timeBucket(hour)}`;
    cells.set(key, [...(cells.get(key) ?? []), post.perf]);
  }
  const grid = DAYS.map((day) => SLOTS.map((slot) => {
    const values = cells.get(`${day}|${slot}`) ?? [];
    return { day, slot, n: values.length, value: median(values) };
  }));
  const ranked = grid.flat().filter((cell) => cell.n >= 2).sort((x, y) => y.value - x.value);
  const busiest = grid.flat().filter((cell) => cell.n).sort((x, y) => y.n - x.n)[0] ?? null;
  return { grid, slots: SLOTS, days: DAYS, best: ranked.slice(0, 3), busiest, sample: scored.length };
}

const FESTIVALS = [
  ['Diwali', /\b(diwali|deepawali|deepavali)\b|दिवाली|दीपावली/i],
  ['Dashain', /\bdashain\b|दशैं|दसैं/i],
  ['Tihar', /\btihar\b|तिहार/i],
  ['Holi', /\bholi\b|होली/i],
  ['Eid', /\b(eid|ramadan|ramzan)\b/i],
  ['Christmas', /\b(christmas|xmas)\b/i],
  ['New Year', /\bnew year\b|नयाँ वर्ष/i],
  ['Navratri and Dussehra', /\b(navratri|navaratri|dussehra|dasara|durga puja)\b|नवरात्रि/i],
  ['Ganesh Chaturthi', /\b(ganesh|ganpati|ganapati) ?chaturthi\b|गणेश/i],
  ['Janmashtami', /\bjanmashtami\b|जन्माष्टमी/i],
  ['Raksha Bandhan', /\b(raksha ?bandhan|rakhi)\b|रक्षा ?बन्धन|रक्षाबंधन/i],
  ['Chhath', /\bchhath\b|छठ/i],
  ['Bhai Dooj and Bhai Tika', /\b(bhai ?dooj|bhai ?tika|bhaitika)\b/i],
  ['Teej', /\bteej\b|तीज/i],
  ['Onam and Pongal', /\b(onam|pongal|sankranti|lohri)\b/i],
  ["Valentine's Day", /\bvalentine/i],
];
const OFFER = /\b(offer|sale|discount|\d+ ?% ?off|deal|combo|hamper|gift ?box|order|booking|book now|price|rs\.?|npr|inr)\b|₹|रु/i;

/** How festival posts perform, and whether festival posts with an offer beat plain greetings. */
export function festivalInsights(scored) {
  const tagged = scored.map((post) => ({ post, festival: FESTIVALS.find(([, pattern]) => pattern.test(post.caption))?.[0] ?? null }))
    .filter((entry) => entry.festival);
  const withOffer = tagged.filter((entry) => OFFER.test(entry.post.caption));
  const greetings = tagged.filter((entry) => !OFFER.test(entry.post.caption));
  const byFestival = [...new Set(tagged.map((entry) => entry.festival))].map((festival) => {
    const posts = tagged.filter((entry) => entry.festival === festival).map((entry) => entry.post);
    return { festival, n: posts.length, value: median(posts.map((p) => p.perf)) };
  }).sort((x, y) => y.value - x.value);
  return {
    festivalPosts: tagged.length,
    festivalValue: median(tagged.map((entry) => entry.post.perf)),
    otherValue: median(scored.filter((post) => !tagged.some((entry) => entry.post === post)).map((p) => p.perf)),
    offer: { n: withOffer.length, value: median(withOffer.map((entry) => entry.post.perf)) },
    greeting: { n: greetings.length, value: median(greetings.map((entry) => entry.post.perf)) },
    byFestival,
  };
}

const languageOf = (post) => dominantScript(post.caption ?? '')?.label ?? null;

/** Mix and cadence use only the feed sample, because the extra Reel fetch would overstate Reels. */
export function computeMetrics(profile, scoredPosts, { timezone = 'UTC', reviewDays = 90, now = Date.now() } = {}) {
  const dated = scoredPosts.filter((p) => p.timestamp);
  const unpinned = dated.filter((p) => !p.isPinned);
  const feed = unpinned.filter((p) => p.inLatest);
  const scored = unpinned.filter((p) => p.perf != null);
  const movingWithViews = unpinned.filter((p) => isMoving(p) && p.views != null);
  const followers = profile.followers;
  const rate = (p) => (engagement(p) != null && followers ? engagement(p) / followers : null);

  const medianViews = median(movingWithViews.map((p) => p.views));
  const rankable = [...scored].sort((a, b) => b.perf - a.perf);
  const winnerCount = Math.min(5, Math.floor(rankable.length / 2));
  const loserCount = Math.min(3, rankable.length - winnerCount);

  const feedTypes = feed.length ? feed : unpinned;
  const mix = Object.entries(FORMATS).map(([type, label]) => {
    const n = feedTypes.filter((p) => p.type === type).length;
    return { label, n, share: feedTypes.length ? n / feedTypes.length : null };
  }).filter((entry) => entry.n > 0);

  return {
    sample: {
      posts: unpinned.length,
      moving: movingWithViews.length,
      feed: feed.length,
      hiddenLikes: unpinned.filter((p) => p.likes == null).length,
      from: unpinned.length ? new Date(Math.min(...unpinned.map(time))).toISOString() : null,
      to: unpinned.length ? new Date(Math.max(...unpinned.map(time))).toISOString() : null,
    },
    followers,
    medianViews,
    viewsPerFollower: medianViews != null && followers ? medianViews / followers : null,
    engagementRate: median(unpinned.map(rate)),
    medianLikes: median(unpinned.map((p) => p.likes)),
    medianComments: median(unpinned.map((p) => p.comments)),
    reelsShare: mix.find((m) => m.label === 'Reel')?.share ?? 0,
    ...windowCadence(feed, reviewDays, now),
    mix,
    winners: rankable.slice(0, winnerCount).map((p) => p.shortCode),
    losers: rankable.slice(rankable.length - loserCount).reverse().map((p) => p.shortCode),
    breakdowns: {
      duration: bucketize(scored, durationBucket, ['Under 15s', '15–30s', '30–60s', 'Over 60s']),
      weekday: bucketize(scored, (p) => localParts(p, timezone).weekday, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
      timeOfDay: bucketize(scored, (p) => timeBucket(localParts(p, timezone).hour),
        ['Morning (6–12)', 'Afternoon (12–17)', 'Evening (17–21)', 'Late (21–24)', 'Night (0–6)']),
      captionLength: bucketize(scored, captionBucket, ['Short (under 80)', 'Medium (80–300)', 'Long (over 300)']),
      question: bucketize(scored, (p) => (p.hook.includes('?') ? 'Opens with a question' : 'No question'),
        ['Opens with a question', 'No question']),
      callToAction: bucketize(scored, (p) => (CTA.test(p.caption) ? 'Has a call to action' : 'No call to action'),
        ['Has a call to action', 'No call to action']),
      formatEngagement: bucketize(unpinned, (p) => FORMATS[p.type], Object.values(FORMATS), rate),
      captionLanguage: bucketize(scored, languageOf, [...new Set(scored.map(languageOf).filter(Boolean))]),
    },
    bestTimes: bestPostingTimes(scored, timezone),
    festivals: festivalInsights(scored),
  };
}

const TIE_MARGIN = 0.05;

function row(key, label, format, a, b, better = 'higher', note = null) {
  let leader = null;
  if (better && a != null && b != null) {
    const top = Math.max(Math.abs(a), Math.abs(b));
    if (top === 0 || Math.abs(a - b) / top < TIE_MARGIN) leader = 'tie';
    else if (better === 'higher') leader = a > b ? 'a' : 'b';
    else leader = a < b ? 'a' : 'b';
  }
  return { key, label, format, a, b, leader, note };
}

export function buildScoreboard(a, b) {
  const ma = a.metrics;
  const mb = b.metrics;
  const intentShare = (account, field) => {
    const intent = account.audience?.intent;
    return intent?.sampled >= 10 ? intent[field] / intent.sampled : null;
  };
  // A handful of comments can't show one company is ahead on buying intent.
  const buyingCounts = (a.audience?.intent?.buyingIntent ?? 0) + (b.audience?.intent?.buyingIntent ?? 0);
  return [
    row('followers', 'Followers', 'count', ma.followers, mb.followers),
    row('medianViews', 'Typical Reel views', 'count', ma.medianViews, mb.medianViews, 'higher', 'Median, so one viral Reel cannot distort it'),
    row('viewsPerFollower', 'Reel views per follower', 'ratio', ma.viewsPerFollower, mb.viewsPerFollower, 'higher', 'Above 1× means Reels travel beyond the follower base'),
    row('engagementRate', 'Engagement rate', 'percent', ma.engagementRate, mb.engagementRate, 'higher', 'Median (likes + comments) ÷ current followers'),
    row('medianLikes', 'Typical likes', 'count', ma.medianLikes, mb.medianLikes),
    row('medianComments', 'Typical comments', 'count', ma.medianComments, mb.medianComments),
    row('buying', 'Comments showing buying intent', 'percent', intentShare(a, 'buyingIntent'), intentShare(b, 'buyingIntent'), buyingCounts >= 10 ? 'higher' : null, 'From sampled comments. Replies to a comment prompt are excluded'),
    row('postsPerWeek', 'Posts per week', 'decimal', ma.postsPerWeek, mb.postsPerWeek, null, 'From the latest feed posts. More is not automatically better'),
    row('reelsShare', 'Reels in the feed', 'percent', ma.reelsShare, mb.reelsShare, null),
    row('longestGapDays', 'Longest gap between posts', 'days', ma.longestGapDays, mb.longestGapDays, 'lower'),
  ];
}
