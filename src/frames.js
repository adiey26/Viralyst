import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 120_000;
const SCENE_CHANGE = 0.3;
const SILENCE_DB = -35;
const MOTION_FPS = 5;
const MAX_TIMELINE_SECONDS = 180;

/** Scraped media links are untrusted, so only Instagram's media hosts over HTTPS are allowed. */
export function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Reads resolution and audio from ffmpeg's stream listing. */
export function parseStreamInfo(log) {
  const size = log.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/);
  const duration = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const width = size ? Number(size[1]) : null;
  const height = size ? Number(size[2]) : null;
  return {
    width,
    height,
    isVertical: width && height ? Math.abs(width / height - 9 / 16) < 0.03 : null,
    hasAudio: /Stream #.*Audio:/.test(log),
    seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
  };
}

export const countCuts = (log) => (log.match(/pts_time:/g) ?? []).length;

/** The time of every detected cut, from ffmpeg's showinfo output. */
export const cutTimes = (log) => [...log.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));

/** Picks moments across a Reel, weighted towards the opening where viewers decide to stay. */
export function sampleTimes(seconds, count = 5) {
  const length = seconds > 0 ? seconds : 1;
  const times = [0, 1, 3, length / 2, length - 1].filter((t) => t >= 0 && t < length);
  return [...new Set(times.map((t) => Number(t.toFixed(1))))].slice(0, count);
}

/** Reads per-frame values that ffmpeg's metadata filters print, paired with each frame's time. */
export function parseMetadataSeries(log, key) {
  const series = [];
  let time = null;
  for (const line of log.split(/\r?\n/)) {
    const at = line.match(/pts_time:(-?\d+(?:\.\d+)?)/);
    if (at) time = Number(at[1]);
    const value = line.match(new RegExp(`${key.replace(/\./g, '\\.')}=(-?(?:\\d+(?:\\.\\d+)?|inf))`));
    if (value && time != null) series.push({ t: time, v: value[1] === '-inf' ? -120 : Number(value[1]) });
  }
  return series;
}

/** Silent stretches from ffmpeg's silencedetect output. */
export function parseSilences(log, duration) {
  const silences = [];
  let start = null;
  for (const line of log.split(/\r?\n/)) {
    const begin = line.match(/silence_start: (-?\d+(?:\.\d+)?)/);
    if (begin) start = Math.max(0, Number(begin[1]));
    const end = line.match(/silence_end: (\d+(?:\.\d+)?)/);
    if (end && start != null) {
      silences.push({ from: start, to: Number(end[1]) });
      start = null;
    }
  }
  if (start != null && duration) silences.push({ from: start, to: duration });
  return silences.map((s) => ({ from: Number(s.from.toFixed(2)), to: Number(s.to.toFixed(2)) }));
}

const average = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
const round = (value, digits = 2) => (value == null ? null : Number(value.toFixed(digits)));

/**
 * Builds a second-by-second picture of a Reel: cuts, on-screen movement and loudness for each
 * second, plus the moments that matter most: when sound and movement start, and the weakest stretch.
 * Retention data is private, so the weakest stretch is a likely drop-off, not a measured one.
 */
export function buildTimeline({ seconds, cuts, motion, loudness, silences, hasAudio }) {
  const length = Math.min(Math.ceil(seconds || 0), MAX_TIMELINE_SECONDS);
  const timeline = [];
  for (let t = 0; t < length; t += 1) {
    const inSecond = (point) => point.t >= t && point.t < t + 1;
    const db = loudness.filter(inSecond).map((p) => p.v);
    timeline.push({
      t,
      cuts: cuts.filter((time) => time >= t && time < t + 1).length,
      motion: round(average(motion.filter(inSecond).map((p) => p.v)), 3),
      loudness: db.length ? round(Math.max(-60, average(db)), 1) : null,
    });
  }

  // Energy mixes movement, sound and cuts, each scaled against the Reel itself.
  const maxMotion = Math.max(0.0001, ...timeline.map((s) => s.motion));
  const loud = timeline.map((s) => s.loudness).filter((v) => v != null);
  const [minDb, maxDb] = loud.length ? [Math.min(...loud), Math.max(...loud)] : [0, 0];
  for (const second of timeline) {
    const sound = second.loudness == null || maxDb === minDb ? 0.5 : (second.loudness - minDb) / (maxDb - minDb);
    second.energy = round(0.5 * (second.motion / maxMotion) + 0.3 * (hasAudio ? sound : 0.5) + 0.2 * Math.min(second.cuts, 1), 3);
  }

  const silentAt = (t) => silences.some((s) => t >= s.from && t < s.to);
  let soundStart = null;
  if (hasAudio) {
    const opening = silences.find((s) => s.from <= 0.05);
    soundStart = opening ? (opening.to < seconds ? round(opening.to, 1) : null) : 0;
  }
  const firstMovement = motion.find((p) => p.v >= 0.02);
  const firstCut = cuts.find((t) => t > 0.2);

  let weakest = null;
  if (timeline.length >= 8) {
    for (let start = 3; start + 3 <= timeline.length; start += 1) {
      const window = average(timeline.slice(start, start + 3).map((s) => s.energy));
      if (!weakest || window < weakest.energy) weakest = { from: start, to: start + 3, energy: round(window, 3) };
    }
  }
  const overall = average(timeline.map((s) => s.energy));
  const ending = timeline.slice(-2);

  return {
    timeline,
    hook: {
      soundStart,
      firstMovement: firstMovement ? round(firstMovement.t, 1) : null,
      firstCut: firstCut != null ? round(firstCut, 1) : null,
      openingEnergy: round(average(timeline.slice(0, 3).map((s) => s.energy)), 3),
    },
    silences: silences.filter((s) => s.to - s.from >= 0.5),
    longestSilence: silences.reduce((max, s) => Math.max(max, s.to - s.from), 0) || 0,
    silentShare: hasAudio && timeline.length ? round(timeline.filter((s) => silentAt(s.t + 0.5)).length / timeline.length) : null,
    weakestStretch: weakest && weakest.energy < overall * 0.7 ? weakest : null,
    averageEnergy: round(overall, 3),
    endingEnergy: round(average(ending.map((s) => s.energy)), 3),
    cutTimes: cuts.map((t) => round(t, 2)),
  };
}

async function ffmpeg(args, allowFailure = false) {
  try {
    return (await run(ffmpegPath, ['-hide_banner', '-protocol_whitelist', 'file,pipe', ...args], {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })).stderr;
  } catch (error) {
    if (allowFailure && typeof error.stderr === 'string') return error.stderr;
    throw error;
  }
}

async function extractFrames(file, dir, times) {
  const frames = [];
  for (const at of times) {
    const output = path.join(dir, `frame-${frames.length}.jpg`);
    await ffmpeg(['-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5', '-y', output], true);
    const names = await readdir(dir);
    if (names.includes(path.basename(output))) {
      frames.push({ atSeconds: at, mediaType: 'image/jpeg', data: (await readFile(output)).toString('base64') });
    }
  }
  return frames;
}

/** Analyses a video file on disk. Used for scraped Reels and for drafts uploaded to the Reel checker. */
export async function analyzeVideoFile(file, { frameCount = 5, frameTimes = null } = {}) {
  if (!ffmpegPath) throw new Error('The video tool is not available on this computer.');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'insta-audit-frames-'));
  try {
    const info = parseStreamInfo(await ffmpeg(['-i', file], true));
    if (!info.seconds || !info.width) throw new Error('This file could not be read as a video.');

    const sceneLog = await ffmpeg(['-i', file, '-filter:v', `select='gt(scene,${SCENE_CHANGE})',showinfo`, '-an', '-f', 'null', '-'], true);
    const cuts = cutTimes(sceneLog);
    const motionLog = await ffmpeg(['-i', file, '-filter:v', `fps=${MOTION_FPS},scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score`, '-an', '-f', 'null', '-'], true);
    const motion = parseMetadataSeries(motionLog, 'lavfi.scene_score');

    let loudness = [];
    let silences = [];
    if (info.hasAudio) {
      const audioLog = await ffmpeg(['-i', file, '-vn', '-af',
        `silencedetect=noise=${SILENCE_DB}dB:d=0.4,aresample=8000,asetnsamples=n=4000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
        '-f', 'null', '-'], true);
      loudness = parseMetadataSeries(audioLog, 'lavfi.astats.Overall.RMS_level');
      silences = parseSilences(audioLog, info.seconds);
    }

    const deep = buildTimeline({ seconds: info.seconds, cuts, motion, loudness, silences, hasAudio: info.hasAudio });
    // frameTimes may be a list, or a function of the video's length for picks that depend on it.
    const times = typeof frameTimes === 'function' ? frameTimes(info.seconds) : frameTimes ?? sampleTimes(info.seconds, frameCount);
    const frames = await extractFrames(file, dir, times.filter((t) => t >= 0 && t < info.seconds));
    return {
      frames,
      stats: {
        ...info,
        cuts: cuts.length,
        cutsPer10Seconds: info.seconds ? Number(((cuts.length / info.seconds) * 10).toFixed(1)) : null,
        ...deep,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Downloads one Reel and analyses it. The video is deleted afterwards, and only the measurements
 * stay in the report.
 */
export async function analyzeVideo(videoUrl, options = {}) {
  if (!ffmpegPath) throw new Error('The video tool is not available on this computer.');
  if (!isAllowedMediaUrl(videoUrl)) throw new Error('The video link is not from Instagram.');
  const response = await fetch(videoUrl, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Video download failed (${response.status}).`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_VIDEO_BYTES) throw new Error('The video is too large.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_VIDEO_BYTES) throw new Error('The video is too large.');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'insta-audit-video-'));
  try {
    const file = path.join(dir, 'reel.mp4');
    await writeFile(file, bytes);
    return await analyzeVideoFile(file, options);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
