import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkAiAccess, runAnalysis } from './analysis.js';
import { fetchAccount, fetchComments, REVIEW_DAYS } from './apify.js';
import { buildAudience, postAudienceHint } from './audience.js';
import { computeAutoChecks } from './checks.js';
import { config } from './config.js';
import { demoAccounts, demoAnalysis, demoInsightsNote } from './demo.js';
import { analyzeVideo, isAllowedMediaUrl } from './frames.js';
import { reelFeedback } from './reelcheck.js';
import { checkLanding } from './landing.js';
import { buildScoreboard, computeMetrics, scorePosts } from './metrics.js';
import { computeScore, fallbackFixes, validateInput } from './score.js';
import { compareAudits, findPrevious } from './progress.js';
import { attributeGrowth, SnapshotStore } from './tracker.js';

const REPORTS_DIR = path.join(config.dataDir, 'reports');
export const THUMBS_DIR = path.join(config.dataDir, 'thumbs');
const TRACKING_DB = path.join(config.dataDir, 'tracking.sqlite');
const THUMB_MAX_BYTES = 5 * 1024 * 1024;
const THUMB_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const REPORT_ID = /^[0-9a-f-]{36}$/;
const APIFY_USD_PER_RESULT = 0.0027; // Apify's listed free-plan rate, used only for the cost estimate.
const GRID_POSTS = 12;
const MAX_IMAGES = 90;
const MAX_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024;

export const openTracker = () => new SnapshotStore(TRACKING_DB);
export const isAllowedImageUrl = isAllowedMediaUrl;

/** Keeps the AI request within size limits, adding images in priority order until the budget is used. */
class ImageBudget {
  constructor() {
    this.images = [];
    this.bytes = 0;
    this.skipped = 0;
  }

  add(label, mediaType, data) {
    if (this.images.length >= MAX_IMAGES || this.bytes + data.length > MAX_IMAGE_BYTES_TOTAL) {
      this.skipped += 1;
      return;
    }
    this.images.push({ label, mediaType, data });
    this.bytes += data.length;
  }
}

async function saveImage(url, name) {
  if (!url || !isAllowedImageUrl(url) || !/^[\w-]+$/.test(name)) return null;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim();
    const extension = THUMB_TYPES[mediaType];
    if (!response.ok || !extension) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > THUMB_MAX_BYTES) return null;
    mkdirSync(THUMBS_DIR, { recursive: true });
    const file = `${name}.${extension}`;
    writeFileSync(path.join(THUMBS_DIR, file), bytes);
    return { file, mediaType, data: bytes.toString('base64') };
  } catch {
    return null;
  }
}

function byCodeOf(account) {
  return new Map(account.posts.map((post) => [post.shortCode, post]));
}

/** Samples comments on the best and worst posts. The audited company gets more posts sampled than competitors. */
async function enrichComments(account, isClient, { warn }) {
  const byCode = byCodeOf(account);
  const outliers = [
    ...account.metrics.winners.slice(0, 3),
    ...(isClient ? account.metrics.losers.slice(0, 2) : []),
  ].map((code) => byCode.get(code));
  if (!outliers.length) return 0;

  try {
    const { byPost, unmatched, total } = await fetchComments(outliers.map((post) => post.url));
    for (const post of outliers) post.commentSample = [...new Set([...(byPost.get(post.shortCode) ?? []), ...post.commentSample])];
    account.extraComments = unmatched;
    return total;
  } catch (error) {
    warn(`Comments could not be fetched for @${account.profile.handle}: ${error.message}`);
    return 0;
  }
}

/** Downloads a few Reels, keeping the measurements on the post and the frames only for the AI request. */
async function reviewVideos(account, isClient, budget, { warn }) {
  const byCode = byCodeOf(account);
  // Ranked among Reels alone, because the best posts overall may be carousels with no video to review.
  const ranked = account.posts.filter((post) => post.videoUrl && post.perf != null).sort((x, y) => y.perf - x.perf);
  const best = ranked.slice(0, isClient ? 3 : 2);
  const worst = isClient ? ranked.slice(best.length).slice(-2).reverse() : [];
  const codes = [...best, ...worst].map((post) => post.shortCode);
  let failures = 0;
  let lastError = '';
  for (const code of codes) {
    const post = byCode.get(code);
    try {
      const { frames, stats } = await analyzeVideo(post.videoUrl, { frameCount: isClient ? 5 : 3 });
      post.video = { ...stats, feedback: reelFeedback(stats) };
      for (const frame of frames) {
        budget.add(`Frame at ${frame.atSeconds}s of post ${code} from @${account.profile.handle}`, frame.mediaType, frame.data);
      }
    } catch (error) {
      failures += 1;
      lastError = error.message;
    }
  }
  if (failures) warn(`${failures} video(s) from @${account.profile.handle} could not be reviewed: ${lastError}`);
}

/** Saves covers for the report, and passes the ones the checkpoints need to the AI. */
async function collectCovers(account, isClient, budget) {
  const byCode = byCodeOf(account);
  const handle = account.profile.handle;
  const ranked = [...account.metrics.winners, ...account.metrics.losers];
  const grid = isClient
    ? [...account.posts].filter((post) => post.timestamp).sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp)).slice(0, GRID_POSTS).map((post) => post.shortCode)
    : [];
  const pinned = isClient ? account.posts.filter((post) => post.isPinned).map((post) => post.shortCode) : [];
  const codes = [...new Set([...ranked, ...pinned, ...grid])];

  const saved = await Promise.all(codes.map(async (code) => {
    const post = byCode.get(code);
    const thumb = await saveImage(post.thumbUrl, post.shortCode);
    if (thumb) post.thumb = `/thumbs/${thumb.file}`;
    return { code, post, thumb };
  }));
  for (const { code, post, thumb } of saved) {
    if (thumb) budget.add(`Cover of ${post.type} post ${code} from @${handle}${post.isPinned ? ' (pinned)' : ''}`, thumb.mediaType, thumb.data);
  }
  if (isClient) {
    const pic = await saveImage(account.profile.picUrl, `profile-${handle.replace(/\./g, '_')}`);
    if (pic) {
      account.profile.thumb = `/thumbs/${pic.file}`;
      budget.add(`Profile photo of @${handle}`, pic.mediaType, pic.data);
    }
  }
}

function prepareAccount(profile, posts, timezone, now) {
  const scored = scorePosts(posts, now);
  return { profile, posts: scored, metrics: computeMetrics(profile, scored, { timezone, reviewDays: REVIEW_DAYS, now }) };
}

function finishAccount(account, history) {
  account.audience = buildAudience(account.profile, account.posts, account.extraComments);
  account.growth = attributeGrowth(history, account.posts);
  for (const post of account.posts) {
    if (post.perf != null) post.audienceHint = postAudienceHint(post);
  }
}

function stripForStorage(account) {
  delete account.profile.picUrl;
  delete account.extraComments;
  for (const post of account.posts) {
    delete post.thumbUrl;
    delete post.videoUrl;
  }
}

function saveReport(report) {
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(path.join(REPORTS_DIR, `${report.id}.json`), JSON.stringify(report));
}

export function loadReport(id) {
  if (!REPORT_ID.test(id)) return null;
  try {
    const report = JSON.parse(readFileSync(path.join(REPORTS_DIR, `${id}.json`), 'utf8'));
    // Reports saved before the framework was added get their measured checks calculated here.
    if (!report.checks && report.accounts?.[0]?.metrics) report.checks = computeAutoChecks(report.accounts);
    const score = computeScore(report);
    const previous = findPrevious(report, readAllReports());
    return { ...report, score, fallbackFixes: fallbackFixes(score), progress: previous ? compareAudits(report, previous) : null };
  } catch {
    return null;
  }
}

/** Applies auditor entries for private checkpoints and returns the rescored report. */
export function saveInputs(id, inputs) {
  const report = loadReport(id);
  if (!report) return null;
  const clean = { ...(report.inputs ?? {}) };
  for (const [checkId, entry] of Object.entries(inputs ?? {})) {
    const value = validateInput(checkId, entry);
    if (value === null) delete clean[checkId];
    else clean[checkId] = value;
  }
  const { score, fallbackFixes: unusedFixes, progress: unusedProgress, ...stored } = report;
  stored.inputs = clean;
  saveReport(stored);
  return loadReport(id);
}

/** Every saved report, read raw. Older reports without measured checks get them here. */
function readAllReports() {
  let files = [];
  try {
    files = readdirSync(REPORTS_DIR).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    try {
      const report = JSON.parse(readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
      if (!report.checks && report.accounts?.[0]?.metrics) report.checks = computeAutoChecks(report.accounts);
      return [report];
    } catch {
      return [];
    }
  });
}

/** Saves extra results onto a report, such as ideas or scripts made from it. */
export function appendToReport(id, key, entry) {
  const report = loadReport(id);
  if (!report) return null;
  const { score, fallbackFixes: unusedFixes, progress: unusedProgress, ...stored } = report;
  stored[key] = [...(stored[key] ?? []), entry].slice(-50);
  saveReport(stored);
  return entry;
}

export function listReports() {
  let files = [];
  try {
    files = readdirSync(REPORTS_DIR).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    try {
      const report = JSON.parse(readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
      return [{
        id: report.id,
        createdAt: report.createdAt,
        mode: report.mode,
        handles: report.accounts.map((account) => account.profile.handle),
        audienceType: report.audienceType === 'creator' ? 'creator' : 'business',
        overall: computeScore({ ...report, checks: report.checks ?? computeAutoChecks(report.accounts) }).overall,
      }];
    } catch {
      return [];
    }
  }).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function baseReport({ mode, audienceType = 'business', notes, brief, timezone, now, warnings }) {
  return {
    id: randomUUID(), createdAt: new Date(now).toISOString(), mode, audienceType: audienceType === 'creator' ? 'creator' : 'business', notes: notes || '', brief: brief ?? null, timezone, warnings, reviewDays: REVIEW_DAYS, inputs: {},
  };
}

export async function runDemoAudit({ timezone = 'UTC', notes = '', brief = null, audienceType = 'business' }, onProgress = () => {}) {
  const now = Date.now();
  onProgress('Building the sample report');
  const accounts = demoAccounts(now).map((demo) => {
    const account = prepareAccount(demo.profile, demo.posts, timezone, now);
    account.landing = demo.landing;
    finishAccount(account, demo.history);
    return account;
  });
  const report = { ...baseReport({ mode: 'demo', audienceType, notes, brief, timezone, now, warnings: [demoInsightsNote] }), accounts };
  report.scoreboard = buildScoreboard(accounts[0], accounts[1]);
  report.checks = computeAutoChecks(accounts);
  report.analysisStatus = { state: 'sample' };
  report.analysis = demoAnalysis(report);
  saveReport(report);
  return { ...report, score: computeScore(report) };
}

export async function runLiveAudit({ a, competitors = [], notes = '', brief = null, timezone = 'UTC', skipAi = false, audienceType = 'business' }, onProgress = () => {}, deps = {}) {
  const { analyse = runAnalysis, hasAnthropicKey = config.hasAnthropicKey, inspectLink = checkLanding, reviewVideo = reviewVideos, checkAi = checkAiAccess } = deps;
  const now = Date.now();
  const warnings = [];
  const warn = (message) => warnings.push(message);
  const handles = [a, ...competitors];
  const useAi = hasAnthropicKey && !skipAi;

  // Finding a Claude problem now avoids paying to scrape accounts for an audit that can't finish.
  if (useAi) {
    onProgress('Checking Claude access');
    const problem = await checkAi();
    if (problem) throw new Error(`${problem} Or tick "Numbers only" to run without the AI checks.`);
  }

  onProgress(`Fetching 90 days of posts for ${handles.length} accounts (usually 2 to 5 minutes)`);
  const raw = await Promise.all(handles.map((handle) => fetchAccount(handle, { warn })));

  const tracker = openTracker();
  try {
    const accounts = raw.map((account) => prepareAccount(account.profile, account.posts, timezone, now));
    for (const account of accounts) {
      if (account.metrics.sample.posts < 5) warn(`@${account.profile.handle} has only ${account.metrics.sample.posts} usable posts in the review period, so its patterns are unreliable.`);
    }

    onProgress('Reading comments on the best and worst posts');
    const commentCounts = await Promise.all(accounts.map((account, i) => enrichComments(account, i === 0, { warn })));

    onProgress('Checking bio links');
    await Promise.all(accounts.map(async (account) => {
      account.landing = await inspectLink(account.profile.externalUrl);
      if (account.landing?.present && !account.landing.ok && !account.landing.platform) {
        warn(`The bio link for @${account.profile.handle} could not be checked automatically (${account.landing.error ?? `HTTP ${account.landing.status}`}). Please check it by hand.`);
      }
    }));

    for (const account of accounts) {
      tracker.record(account.profile, new Date(now));
      finishAccount(account, tracker.history(account.profile.handle));
    }

    const report = { ...baseReport({ mode: 'live', audienceType, notes, brief, timezone, now, warnings }), accounts };
    report.scoreboard = accounts[1] ? buildScoreboard(accounts[0], accounts[1]) : [];
    report.checks = computeAutoChecks(accounts);

    const resultCount = handles.length + accounts.reduce((sum, account) => sum + account.posts.length, 0)
      + commentCounts.reduce((sum, count) => sum + count, 0);
    report.scrapeCostEstimateUsd = resultCount * APIFY_USD_PER_RESULT;

    const budget = new ImageBudget();
    onProgress('Saving covers and reviewing video frames');
    for (const [i, account] of accounts.entries()) await collectCovers(account, i === 0, budget);
    for (const [i, account] of accounts.entries()) await reviewVideo(account, i === 0, budget, { warn });
    if (budget.skipped) warn(`${budget.skipped} image(s) were left out of the AI review to stay within size limits.`);
    accounts.forEach(stripForStorage);

    if (useAi) {
      onProgress('Writing the audit (usually 2 to 5 minutes)');
      const result = await analyse(report, budget.images);
      report.analysisStatus = {
        state: result.state,
        reason: result.reason,
        usage: result.usage,
        removedRefs: result.removedRefs,
      };
      report.analysis = result.analysis ?? null;
      if (result.removedRefs) warn(`The AI cited ${result.removedRefs} post(s) that do not exist. Those references were removed.`);
    } else {
      report.analysisStatus = { state: 'off', reason: skipAi ? 'This audit was run as numbers only, so AI checkpoints and written deliverables are missing.' : 'No Anthropic key is set, so AI checkpoints and written deliverables are missing.' };
      report.analysis = null;
    }

    saveReport(report);
    return { ...report, score: computeScore(report) };
  } finally {
    tracker.close();
  }
}
