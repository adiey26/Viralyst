import { ALL_CHECKS, CHECK_BY_ID, PILLARS, RATINGS, ratingFor, scoreFromNumber } from './framework.js';

const NOTE_LIMIT = 500;

/** Checks auditor input against the framework and returns the clean value. Null clears an entry. */
export function validateInput(id, entry) {
  const item = CHECK_BY_ID.get(id);
  if (!item) throw new Error(`Unknown checkpoint ${id}.`);
  if (entry === null) return null;
  const note = String(entry?.note ?? '').trim().slice(0, NOTE_LIMIT);
  if (entry?.value !== undefined && entry.value !== null && entry.value !== '') {
    const value = Number(entry.value);
    if (!item.input || !Number.isFinite(value)) throw new Error(`${item.title} needs a number.`);
    return { value, note };
  }
  if (entry?.rating && RATINGS[entry.rating]) return { rating: entry.rating, note };
  throw new Error(`Please choose a rating for ${item.title}.`);
}

function enteredResult(item, entry) {
  if (entry.value !== undefined) {
    return {
      score: scoreFromNumber(item.input, entry.value),
      provenance: 'entered',
      finding: `${item.input.label}: ${entry.value}${item.input.unit === '%' ? '%' : ` ${item.input.unit}`}.`,
      note: entry.note,
    };
  }
  return {
    score: RATINGS[entry.rating].score,
    provenance: 'entered',
    finding: `Rated ${RATINGS[entry.rating].label} by the auditor.`,
    rating: entry.rating,
    note: entry.note,
  };
}

function resolveCheck(item, report, aiById) {
  const entry = report.inputs?.[item.id];
  if (entry) return enteredResult(item, entry);
  const auto = report.checks?.[item.id];
  if (auto) return { ...auto, provenance: 'measured' };
  const ai = aiById.get(item.id);
  if (ai?.can_assess) {
    return {
      score: Math.max(0, Math.min(100, Math.round(ai.score))),
      provenance: 'ai',
      finding: ai.finding,
      evidence: ai.evidence,
      fix: ai.fix,
      confidence: ai.confidence,
      post_refs: ai.post_refs,
    };
  }
  return ai ? { score: null, provenance: 'ai', finding: ai.finding } : { score: null, provenance: null };
}

/**
 * Builds the Viralyst Score. Each pillar averages its scored checkpoints. Unscored pillars are left
 * out and the remaining weights are rescaled, so missing data never counts as zero or as a guess.
 * coverage shows how much of the framework the score actually rests on.
 */
export function computeScore(report) {
  const aiById = new Map((report.analysis?.checkpoints ?? []).map((item) => [item.id, item]));
  const pillars = PILLARS.map((pillar) => {
    const checks = pillar.checks.map((item) => ({
      id: item.id,
      title: item.title,
      lookAt: item.lookAt,
      why: item.why,
      source: item.source,
      partial: item.partial ?? null,
      hint: item.hint ?? null,
      input: item.input ? { label: item.input.label, unit: item.input.unit } : null,
      ...resolveCheck(item, report, aiById),
    }));
    const scored = checks.filter((item) => item.score != null);
    const score = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : null;
    return {
      id: pillar.id,
      title: pillar.title,
      weight: pillar.weight,
      score,
      rating: score == null ? null : ratingFor(score),
      scoredCount: scored.length,
      totalCount: checks.length,
      checks,
    };
  });

  const counted = pillars.filter((pillar) => pillar.score != null);
  const weightSum = counted.reduce((sum, pillar) => sum + pillar.weight, 0);
  const overall = weightSum ? Math.round(counted.reduce((sum, pillar) => sum + pillar.score * pillar.weight, 0) / weightSum) : null;
  const scoredChecks = pillars.reduce((sum, pillar) => sum + pillar.scoredCount, 0);
  const all = pillars.flatMap((pillar) => pillar.checks);

  return {
    overall,
    rating: overall == null ? null : ratingFor(overall),
    pillars,
    coverage: {
      scored: scoredChecks,
      total: ALL_CHECKS.length,
      weightShare: pillars.reduce((sum, pillar) => sum + (pillar.weight * pillar.scoredCount) / pillar.totalCount, 0) / 100,
      measured: all.filter((item) => item.score != null && item.provenance === 'measured').length,
      ai: all.filter((item) => item.score != null && item.provenance === 'ai').length,
      entered: all.filter((item) => item.score != null && item.provenance === 'entered').length,
    },
  };
}

/** Used when no AI list exists: the fixes that would move the weighted score most. */
export function fallbackFixes(score, limit = 10) {
  return score.pillars
    .flatMap((pillar) => pillar.checks.map((item) => ({ item, weight: pillar.weight / pillar.totalCount })))
    .filter(({ item }) => item.score != null && item.fix && item.score < 85)
    .sort((x, y) => (100 - y.item.score) * y.weight - (100 - x.item.score) * x.weight)
    .slice(0, limit)
    .map(({ item }) => ({ fix: item.fix, why: item.finding, checkpoint_id: item.id }));
}
