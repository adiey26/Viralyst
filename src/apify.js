import { config } from './config.js';

const PROFILE_ACTOR = 'apify~instagram-profile-scraper';
const POST_ACTOR = 'apify~instagram-post-scraper';
const REEL_ACTOR = 'apify~instagram-reel-scraper';
export const REVIEW_DAYS = 90;
const MIN_POSTS_FOR_PATTERNS = 12;
const POSTS_WHEN_EXTENDED = 30;
const COMMENT_ACTOR = 'apify~instagram-comment-scraper';
const RUN_TIMEOUT_MS = 320_000; // Apify ends synchronous runs at 300 seconds with a 408.

export class ScrapeError extends Error {}

const STATUS_MESSAGES = {
  400: 'Apify rejected the request as invalid.',
  401: 'Apify rejected your token. Press Change keys and paste your Personal API token from Apify again.',
  402: 'Your Apify account is out of credit or over its usage limit.',
  403: 'Your Apify token does not have permission to run this scraper.',
  408: 'The scrape took longer than Apify allows (5 minutes). Try lowering POSTS_PER_ACCOUNT.',
};

// Apify plans limit how many scrapers run at once (5 on the free plan), and going over returns a 402.
const MAX_CONCURRENT_RUNS = 3;
const BUSY_RETRIES = 3;
let activeRuns = 0;
const waitingRuns = [];

async function withRunSlot(task) {
  if (activeRuns >= MAX_CONCURRENT_RUNS) await new Promise((resolve) => { waitingRuns.push(resolve); });
  activeRuns += 1;
  try {
    return await task();
  } finally {
    activeRuns -= 1;
    waitingRuns.shift()?.();
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function runActor(actor, input, { fetchImpl = fetch, token = config.apifyToken, maxItems, busyDelayMs = 20_000 } = {}) {
  if (!token) throw new ScrapeError('No Apify token is set, so real accounts cannot be fetched. Add one in Connect your keys.');
  const query = new URLSearchParams({ maxTotalChargeUsd: String(config.apifyMaxUsdPerRun) });
  if (maxItems) query.set('maxItems', String(maxItems));

  for (let attempt = 0; ; attempt += 1) {
    const result = await withRunSlot(async () => {
      let response;
      try {
        response = await fetchImpl(`https://api.apify.com/v2/actors/${actor}/run-sync-get-dataset-items?${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ScrapeError(`Could not reach Apify: ${error.message}`);
      }
      if (response.ok) return { items: await response.json() };
      const detail = (await response.json().catch(() => null))?.error;
      return { status: response.status, detail };
    });

    if (result.items) {
      if (!Array.isArray(result.items)) throw new ScrapeError('Apify returned an unexpected response.');
      return result.items;
    }
    const text = `${result.detail?.type ?? ''} ${result.detail?.message ?? ''}`;
    const isBusy = result.status === 402 && /memory|concurren|too many/i.test(text);
    if (isBusy && attempt < BUSY_RETRIES) {
      await sleep(busyDelayMs);
      continue;
    }
    if (isBusy) throw new ScrapeError('Too many Apify scrapers are running on your account. Wait a few minutes and try again.');
    if (result.status === 402 && result.detail?.message) throw new ScrapeError(`Apify could not start the scrape: ${result.detail.message}`);
    throw new ScrapeError(STATUS_MESSAGES[result.status] ?? `Apify returned an error (HTTP ${result.status}).`);
  }
}

const num = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

function postType(raw, fromReelScraper) {
  if (fromReelScraper || raw.productType === 'clips') return 'reel';
  if (raw.type === 'Sidecar') return 'carousel';
  if (raw.type === 'Video') return 'video';
  return 'image';
}

export function normalizePost(raw, { fromReelScraper = false, inLatest = false } = {}) {
  const shortCode = raw.shortCode ?? raw.shortcode;
  if (!shortCode) return null;
  // The scraper reports hidden like counts as -1, so num() turns those into null.
  // Plays is the number Instagram displays on a Reel, so it takes priority over the older view count.
  return {
    shortCode,
    url: `https://www.instagram.com/p/${shortCode}/`,
    type: postType(raw, fromReelScraper),
    caption: raw.caption ?? '',
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
    mentions: Array.isArray(raw.mentions) ? raw.mentions : [],
    likes: num(raw.likesCount),
    comments: raw.isCommentsDisabled ? null : num(raw.commentsCount),
    views: num(raw.videoPlayCount) ?? num(raw.videoViewCount),
    duration: num(raw.videoDuration),
    timestamp: raw.timestamp ?? null,
    location: raw.locationName ?? null,
    thumbUrl: raw.displayUrl ?? null,
    videoUrl: raw.videoUrl ?? null,
    isPinned: Boolean(raw.isPinned),
    slides: Array.isArray(raw.childPosts) ? raw.childPosts.length : 0,
    alt: raw.alt ?? null,
    taggedUsers: (raw.taggedUsers ?? []).map((user) => user?.username).filter(Boolean),
    coauthors: (raw.coauthorProducers ?? []).map((user) => user?.username).filter(Boolean),
    music: raw.musicInfo
      ? { artist: raw.musicInfo.artist_name ?? null, song: raw.musicInfo.song_name ?? null, isOriginal: raw.musicInfo.uses_original_audio ?? null, muted: raw.musicInfo.should_mute_audio ?? null }
      : null,
    shares: num(raw.sharesCount) ?? num(raw.shareCount),
    paidPartnership: Boolean(raw.paidPartnership),
    transcript: typeof raw.transcript === 'string' ? raw.transcript : null,
    commentSample: (raw.latestComments ?? []).map((c) => c?.text).filter(Boolean),
    inLatest,
  };
}

export function normalizeProfile(raw) {
  return {
    handle: raw.username.toLowerCase(),
    fullName: raw.fullName ?? '',
    bio: raw.biography ?? '',
    followers: num(raw.followersCount),
    following: num(raw.followsCount),
    postsCount: num(raw.postsCount),
    highlights: num(raw.highlightReelCount),
    isBusiness: Boolean(raw.isBusinessAccount),
    category: raw.businessCategoryName ?? null,
    verified: Boolean(raw.verified),
    externalUrl: raw.externalUrl ?? null,
    country: raw.about?.country ?? null,
    picUrl: raw.profilePicUrlHD ?? raw.profilePicUrl ?? null,
    relatedProfiles: (raw.relatedProfiles ?? []).filter((p) => p?.username && !p.is_private).slice(0, 12)
      .map((p) => ({ handle: String(p.username).toLowerCase(), fullName: p.full_name ?? '', verified: Boolean(p.is_verified) })),
    url: `https://www.instagram.com/${raw.username}/`,
  };
}

/** Reel scraper values win because they include plays and duration; feed values add non-Reel posts. */
export function mergePosts(latest, reels) {
  const byCode = new Map(latest.map((post) => [post.shortCode, post]));
  for (const reel of reels) {
    const existing = byCode.get(reel.shortCode);
    byCode.set(reel.shortCode, existing
      ? {
        ...existing,
        ...reel,
        inLatest: existing.inLatest || reel.inLatest,
        isPinned: existing.isPinned || reel.isPinned,
        type: reel.type === 'reel' ? 'reel' : existing.type,
        views: reel.views ?? existing.views,
        shares: reel.shares ?? existing.shares,
        transcript: reel.transcript ?? existing.transcript,
        videoUrl: reel.videoUrl ?? existing.videoUrl,
      }
      : reel);
  }
  return [...byCode.values()];
}

export async function fetchProfileRaw(handle, options) {
  const items = await runActor(PROFILE_ACTOR, { usernames: [handle], includeAboutSection: false }, options);
  const raw = items.find((item) => item?.username?.toLowerCase() === handle);
  if (!raw) throw new ScrapeError(`@${handle} was not found on Instagram, or its data could not be read.`);
  if (raw.private) throw new ScrapeError(`@${handle} is a private account, so its posts cannot be analysed.`);
  return raw;
}

export async function fetchSnapshot(handle, options) {
  return normalizeProfile(await fetchProfileRaw(handle, options));
}

export async function fetchAccount(handle, { warn = () => {}, ...options } = {}) {
  const raw = await fetchProfileRaw(handle, options);
  const cutoff = Date.now() - REVIEW_DAYS * 86_400_000;
  // The profile's latest posts reveal which ones are pinned, even if they're older than the review period.
  const latest = (raw.latestPosts ?? []).map((p) => normalizePost(p, { inLatest: true })).filter(Boolean)
    .filter((post) => post.isPinned || new Date(post.timestamp).getTime() >= cutoff);

  const scrape = async (actor, input, inLatest, fromReelScraper = false) => {
    const items = await runActor(actor, { username: [handle], onlyPostsNewerThan: `${REVIEW_DAYS} days`, resultsLimit: config.postsPerAccount, ...input }, options);
    return items.filter((item) => !item.error).map((p) => normalizePost(p, { inLatest, fromReelScraper })).filter(Boolean);
  };

  let posts = [];
  try {
    posts = await scrape(POST_ACTOR, {}, true);
  } catch (error) {
    warn(`Posts for @${handle} could not be fetched (${error.message}). This report only uses its latest ${latest.length} posts.`);
  }
  let reels = [];
  if (config.includeTranscripts || config.includeShares) {
    try {
      reels = await scrape(REEL_ACTOR, { includeTranscript: config.includeTranscripts, includeSharesCount: config.includeShares }, false, true);
    } catch (error) {
      warn(`Transcripts or share counts for @${handle} could not be fetched (${error.message}).`);
    }
  }

  // Too few recent posts can't show patterns, so older ones help the content analysis.
  // Cadence still uses only the review period, through inWindow.
  const recent = posts.length;
  if (recent >= config.postsPerAccount) {
    const oldest = Math.min(...posts.map((post) => new Date(post.timestamp).getTime()));
    const days = Math.round((Date.now() - oldest) / 86_400_000);
    if (days < REVIEW_DAYS) warn(`@${handle} reached the limit of ${config.postsPerAccount} posts, so this report covers its last ${days} days rather than ${REVIEW_DAYS}.`);
  }
  let older = [];
  if (recent < MIN_POSTS_FOR_PATTERNS) {
    try {
      older = await scrape(POST_ACTOR, { onlyPostsNewerThan: undefined, resultsLimit: POSTS_WHEN_EXTENDED }, true);
      if (older.length > recent) warn(`@${handle} posted ${recent === 1 ? 'once' : `${recent} times`} in the last ${REVIEW_DAYS} days, so older posts were added to find content patterns. Posting consistency still uses the ${REVIEW_DAYS} days.`);
    } catch (error) {
      warn(`Older posts for @${handle} could not be fetched (${error.message}).`);
    }
  }

  const merged = mergePosts(mergePosts(mergePosts(latest, older), posts), reels);
  return {
    profile: normalizeProfile(raw),
    posts: merged.map((post) => ({ ...post, inWindow: new Date(post.timestamp).getTime() >= cutoff })),
  };
}

const shortCodeOf = (url) => String(url ?? '').match(/\/(?:p|reel|tv)\/([\w-]+)/)?.[1] ?? null;

/** Fetches comments for several posts in one run. Comments that can't be matched to a post stay in unmatched. */
export async function fetchComments(postUrls, options) {
  const items = await runActor(COMMENT_ACTOR, { directUrls: postUrls, resultsLimit: config.commentsPerPost }, options);
  const byPost = new Map();
  const unmatched = [];
  for (const item of items) {
    if (typeof item?.text !== 'string' || !item.text.trim()) continue;
    const code = shortCodeOf(item.postUrl ?? item.inputUrl);
    if (code) byPost.set(code, [...(byPost.get(code) ?? []), item.text]);
    else unmatched.push(item.text);
  }
  return { byPost, unmatched, total: items.length };
}
