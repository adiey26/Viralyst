// The Reel checker: analyses a draft video (uploaded) or a posted Reel (by link), scores it, and
// keeps the result so versions can be compared. Videos are deleted after analysis.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runActor } from './apify.js';
import { reviewReel } from './assistant.js';
import { config } from './config.js';
import { analyzeVideo, analyzeVideoFile } from './frames.js';
import { reelFeedback } from './reelcheck.js';

const CHECKS_DIR = path.join(config.dataDir, 'reel-checks');
const THUMBS_DIR = path.join(config.dataDir, 'thumbs');
const CHECK_ID = /^[0-9a-f-]{36}$/;
const REEL_LINK = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/([\w-]+)\/?/i;

/** Frame times that favour the opening, where viewers decide, plus the weakest stretch and the end. */
export function reviewFrameTimes(seconds) {
  const length = Math.max(seconds || 1, 1);
  const times = [0, 0.5, 1, 2, 3, length * 0.4, length * 0.6, length * 0.8, length - 0.7];
  return [...new Set(times.filter((t) => t >= 0 && t < length).map((t) => Number(t.toFixed(1))))].slice(0, 9);
}

export function parseReelLink(value) {
  const match = String(value ?? '').trim().match(REEL_LINK);
  if (!match) throw new Error('Please paste a link to an Instagram Reel or post.');
  return { url: `https://www.instagram.com/${match[2].toLowerCase() === 'p' ? 'p' : 'reel'}/${match[3]}/`, code: match[3] };
}

function save(check) {
  mkdirSync(CHECKS_DIR, { recursive: true });
  writeFileSync(path.join(CHECKS_DIR, `${check.id}.json`), JSON.stringify(check));
}

export function loadReelCheck(id) {
  if (!CHECK_ID.test(id)) return null;
  try {
    return JSON.parse(readFileSync(path.join(CHECKS_DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export function listReelChecks() {
  let files = [];
  try {
    files = readdirSync(CHECKS_DIR).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    try {
      const check = JSON.parse(readFileSync(path.join(CHECKS_DIR, file), 'utf8'));
      return [{ id: check.id, name: check.name, createdAt: check.createdAt, source: check.source, thumb: check.thumb, measured: check.feedback.overall, ai: check.ai?.review?.overall_score ?? null, seconds: check.stats.seconds }];
    } catch {
      return [];
    }
  }).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

async function finish({ id, name, source, link, analysis, audienceType, goal, useAi, onProgress, review }) {
  const { frames, stats } = analysis;
  const feedback = reelFeedback(stats);
  let thumb = null;
  if (frames[0]) {
    mkdirSync(THUMBS_DIR, { recursive: true });
    writeFileSync(path.join(THUMBS_DIR, `check-${id}.jpg`), Buffer.from(frames[0].data, 'base64'));
    thumb = `/thumbs/check-${id}.jpg`;
  }
  let ai = null;
  if (useAi) {
    onProgress('Reviewing the frames with AI');
    try {
      const { review: result, usage } = await review({ stats, feedback, frames, audienceType, goal });
      ai = { state: 'done', review: result, usage };
    } catch (error) {
      ai = { state: 'failed', reason: error.message };
    }
  }
  const check = { id, name, createdAt: new Date().toISOString(), source, link: link ?? null, audienceType, goal: goal || '', thumb, stats, feedback, ai, frameTimes: frames.map((f) => f.atSeconds) };
  save(check);
  return check;
}

const cleanName = (name, fallback) => String(name ?? '').trim().slice(0, 80) || fallback;

/** Checks an uploaded video file. */
export async function checkUploadedReel(file, { name, audienceType, goal, useAi }, onProgress = () => {}, deps = {}) {
  const { analyse = analyzeVideoFile, review = reviewReel } = deps;
  onProgress('Measuring the video second by second');
  const analysis = await analyse(file, { frameTimes: reviewFrameTimes });
  return finish({ id: randomUUID(), name: cleanName(name, 'Untitled draft'), source: 'upload', analysis, audienceType, goal, useAi, onProgress, review });
}

/** Checks a posted Reel from its Instagram link. */
export async function checkLinkedReel(link, { name, audienceType, goal, useAi }, onProgress = () => {}, deps = {}) {
  const { fetchPost = (url) => runActor('apify~instagram-post-scraper', { username: [url], resultsLimit: 1 }), analyse = analyzeVideo, review = reviewReel } = deps;
  const { url, code } = parseReelLink(link);
  onProgress('Fetching the Reel');
  const items = await fetchPost(url);
  const post = items.find((item) => item?.videoUrl);
  if (!post) throw new Error('That post has no video, or it could not be fetched. Check the link is a public Reel.');
  onProgress('Measuring the video second by second');
  const analysis = await analyse(post.videoUrl, { frameTimes: reviewFrameTimes });
  return finish({ id: randomUUID(), name: cleanName(name, `Reel ${code}`), source: 'link', link: url, analysis, audienceType, goal, useAi, onProgress, review });
}
