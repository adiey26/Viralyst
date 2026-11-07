import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 90_000;
const SCENE_CHANGE = 0.3;

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

/** Picks moments across a Reel, weighted towards the opening where viewers decide to stay. */
export function sampleTimes(seconds, count = 5) {
  const length = seconds > 0 ? seconds : 1;
  const times = [0, 1, 3, length / 2, length - 1].filter((t) => t >= 0 && t < length);
  return [...new Set(times.map((t) => Number(t.toFixed(1))))].slice(0, count);
}

async function ffmpeg(args, allowFailure = false) {
  try {
    return (await run(ffmpegPath, ['-hide_banner', '-protocol_whitelist', 'file,pipe', ...args], {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    })).stderr;
  } catch (error) {
    if (allowFailure && typeof error.stderr === 'string') return error.stderr;
    throw error;
  }
}

/**
 * Downloads one Reel and returns sampled frames plus measured cuts, resolution and audio.
 * The video is deleted afterwards, and only the measurements stay in the report.
 */
export async function analyzeVideo(videoUrl, { frameCount = 5 } = {}) {
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
    const info = parseStreamInfo(await ffmpeg(['-i', file], true));

    const frames = [];
    for (const at of sampleTimes(info.seconds, frameCount)) {
      const output = path.join(dir, `frame-${frames.length}.jpg`);
      await ffmpeg(['-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5', '-y', output]);
      const names = await readdir(dir);
      if (names.includes(path.basename(output))) {
        frames.push({ atSeconds: at, mediaType: 'image/jpeg', data: (await readFile(output)).toString('base64') });
      }
    }

    const sceneLog = await ffmpeg(['-i', file, '-filter:v', `select='gt(scene,${SCENE_CHANGE})',showinfo`, '-an', '-f', 'null', '-'], true);
    const cuts = countCuts(sceneLog);
    return {
      frames,
      stats: {
        ...info,
        cuts,
        cutsPer10Seconds: info.seconds ? Number(((cuts / info.seconds) * 10).toFixed(1)) : null,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
