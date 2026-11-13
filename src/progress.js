// Before and after: compares an audit with the previous audit of the same account, and checks
// whether each earlier fix has moved its checkpoint. This is how a client sees what improved.
import { modeOf } from './framework.js';
import { computeScore, fallbackFixes } from './score.js';

const METRICS = [
  ['followers', 'Followers', 'count'],
  ['medianViews', 'Typical Reel views', 'count'],
  ['viewsPerFollower', 'Reel views per follower', 'ratio'],
  ['engagementRate', 'Engagement rate', 'percent'],
  ['postsPerWeek', 'Posts per week', 'decimal'],
];

/** Picks the most recent earlier audit of the same account in the same mode. */
export function findPrevious(report, candidates) {
  const handle = report.accounts?.[0]?.profile?.handle;
  return candidates
    .filter((other) => other.id !== report.id
      && other.mode === report.mode
      && modeOf(other) === modeOf(report)
      && other.accounts?.[0]?.profile?.handle === handle
      && other.createdAt < report.createdAt)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] ?? null;
}

const checkScores = (score) => new Map(score.pillars.flatMap((pillar) => pillar.checks.map((check) => [check.id, check.score])));

/** What changed between two audits, including whether the earlier recommended fixes worked. */
export function compareAudits(current, previous) {
  const now = computeScore(current);
  const before = computeScore(previous);
  const nowChecks = checkScores(now);
  const beforeChecks = checkScores(before);
  const [a, b] = [current.accounts[0].metrics, previous.accounts[0].metrics];

  const earlierFixes = previous.analysis?.top_10_fixes?.length ? previous.analysis.top_10_fixes : fallbackFixes(before);
  const fixes = earlierFixes.map((fix) => {
    const was = beforeChecks.get(fix.checkpoint_id) ?? null;
    const is = nowChecks.get(fix.checkpoint_id) ?? null;
    let status = 'unknown';
    if (was != null && is != null) status = is > was + 2 ? 'improved' : is < was - 2 ? 'worse' : 'unchanged';
    return { fix: fix.fix, checkpointId: fix.checkpoint_id ?? null, before: was, after: is, status };
  });

  return {
    previousId: previous.id,
    previousDate: previous.createdAt,
    daysBetween: Math.round((new Date(current.createdAt) - new Date(previous.createdAt)) / 86_400_000),
    score: { before: before.overall, after: now.overall, change: now.overall != null && before.overall != null ? now.overall - before.overall : null },
    pillars: now.pillars.map((pillar) => {
      const old = before.pillars.find((p) => p.id === pillar.id);
      return { id: pillar.id, title: pillar.title, before: old?.score ?? null, after: pillar.score, change: pillar.score != null && old?.score != null ? pillar.score - old.score : null };
    }),
    metrics: METRICS.map(([key, label, format]) => ({ key, label, format, before: b[key] ?? null, after: a[key] ?? null })),
    fixes,
    fixesImproved: fixes.filter((fix) => fix.status === 'improved').length,
    fixesTracked: fixes.filter((fix) => fix.status !== 'unknown').length,
  };
}
