import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { median } from './metrics.js';

const DAY_MS = 86_400_000;
export const MIN_DAYS = 7;

export class SnapshotStore {
  constructor(file) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS snapshots (
      handle TEXT NOT NULL,
      day TEXT NOT NULL,
      taken_at TEXT NOT NULL,
      followers INTEGER NOT NULL,
      following INTEGER,
      posts INTEGER,
      PRIMARY KEY (handle, day)
    )`);
  }

  /** Keeps one row per account per UTC day; a later reading the same day replaces it. */
  record(profile, takenAt = new Date()) {
    if (profile.followers == null) return;
    this.db.prepare(`INSERT OR REPLACE INTO snapshots (handle, day, taken_at, followers, following, posts)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      profile.handle, takenAt.toISOString().slice(0, 10), takenAt.toISOString(),
      profile.followers, profile.following ?? null, profile.postsCount ?? null,
    );
  }

  history(handle) {
    return this.db.prepare('SELECT taken_at AS takenAt, followers FROM snapshots WHERE handle = ? ORDER BY day').all(handle)
      .map((row) => ({ ...row }));
  }

  handles() {
    return this.db.prepare('SELECT DISTINCT handle FROM snapshots ORDER BY handle').all().map((row) => row.handle);
  }

  lastTaken(handle) {
    return this.db.prepare('SELECT MAX(taken_at) AS takenAt FROM snapshots WHERE handle = ?').get(handle)?.takenAt ?? null;
  }

  close() {
    this.db.close();
  }
}

/**
 * Finds unusual jumps in daily follower gains and lists posts published around each one.
 * It shows timing only: a jump could also come from ads, press or a collaboration.
 */
export function attributeGrowth(history, posts) {
  const days = history.length;
  const status = days >= MIN_DAYS ? 'ready' : 'collecting';
  const steps = history.slice(1).map((point, i) => {
    const previous = history[i];
    const gapDays = Math.max((new Date(point.takenAt) - new Date(previous.takenAt)) / DAY_MS, 1 / 24);
    const gain = point.followers - previous.followers;
    return { from: previous.takenAt, to: point.takenAt, gapDays, gain, perDay: gain / gapDays };
  });

  const result = {
    status,
    days,
    requiredDays: MIN_DAYS,
    series: history,
    netGain: days >= 2 ? history.at(-1).followers - history[0].followers : null,
    typicalPerDay: null,
    spikes: [],
  };
  if (status !== 'ready') return result;

  const typical = median(steps.map((step) => step.perDay));
  const spread = median(steps.map((step) => Math.abs(step.perDay - typical)));
  const minJump = Math.max(5, history.at(-1).followers * 0.0005);
  const threshold = typical + Math.max(3 * spread, Math.abs(typical), minJump);
  result.typicalPerDay = typical;

  result.spikes = steps.filter((step) => step.perDay >= threshold).map((step) => {
    const windowStart = new Date(step.from).getTime() - DAY_MS; // Followers can arrive a day or so after posting.
    const windowEnd = new Date(step.to).getTime();
    const candidates = posts.filter((post) => {
      const t = new Date(post.timestamp).getTime();
      return t >= windowStart && t <= windowEnd;
    }).map((post) => post.shortCode);
    let confidence = 'unexplained';
    if (candidates.length === 1 && step.gapDays <= 2) confidence = 'likely';
    else if (candidates.length) confidence = 'possible';
    return { ...step, candidates, confidence };
  });
  return result;
}
