// Turns measured video stats into a scored review: hook, pacing, audio, ending, format and length.
// These rules work without AI. With AI, they are given to Claude alongside the frames.
// The thresholds are starting assumptions that can be adjusted here.

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
const secs = (value) => `${Number(value).toFixed(1)}s`;

const WEIGHTS = { hook: 0.3, pacing: 0.2, audio: 0.15, ending: 0.15, format: 0.1, length: 0.1 };

export function reelFeedback(stats, { bestLength = null } = {}) {
  const parts = [];
  const add = (key, label, score, notes, fixes = []) => parts.push({ key, label, score: clamp(score), notes, fixes });
  const { hook = {} } = stats;

  // Hook: the first three seconds decide whether anyone stays.
  {
    let score = 85;
    const notes = [];
    const fixes = [];
    if (stats.hasAudio && hook.soundStart != null && hook.soundStart > 1) {
      score -= 25;
      notes.push(`Sound starts at ${secs(hook.soundStart)}.`);
      fixes.push('Start speaking or bring the music in within the first second.');
    } else if (stats.hasAudio && hook.soundStart == null) {
      score -= 25;
      notes.push('No clear sound in the opening.');
      fixes.push('Open with your voice or a strong sound.');
    }
    if (hook.firstMovement == null || hook.firstMovement > 1.5) {
      score -= 20;
      notes.push(hook.firstMovement == null ? 'The picture barely changes.' : `Nothing moves on screen until ${secs(hook.firstMovement)}.`);
      fixes.push('Show movement, a face or the product in the very first second.');
    }
    if (stats.averageEnergy && hook.openingEnergy < stats.averageEnergy * 0.8) {
      score -= 15;
      notes.push('The opening is calmer than the rest of the Reel.');
      fixes.push('Move your strongest moment to the start.');
    }
    if (!notes.length) notes.push('Sound and movement both start quickly.');
    add('hook', 'Hook (first 3 seconds)', score, notes, fixes);
  }

  // Pacing: cuts and the weakest stretch.
  {
    let score = 85;
    const notes = [`${stats.cutsPer10Seconds ?? 0} cuts per 10 seconds.`];
    const fixes = [];
    if ((stats.cutsPer10Seconds ?? 0) < 1 && stats.seconds > 10) {
      score = 55;
      fixes.push('Break long shots with a cut, zoom or new angle every 3 to 5 seconds.');
    } else if ((stats.cutsPer10Seconds ?? 0) > 8) {
      score = 65;
      fixes.push('Very fast cutting can be hard to follow. Give key moments a little longer.');
    }
    if (stats.weakestStretch) {
      score -= 15;
      notes.push(`Energy dips from ${stats.weakestStretch.from}s to ${stats.weakestStretch.to}s, a likely point where viewers leave.`);
      fixes.push(`Tighten or cut ${stats.weakestStretch.from}s to ${stats.weakestStretch.to}s, or add a visual change there.`);
    }
    add('pacing', 'Pacing', score, notes, fixes);
  }

  // Audio.
  {
    let score = 85;
    const notes = [];
    const fixes = [];
    if (!stats.hasAudio) {
      score = 40;
      notes.push('There is no audio track.');
      fixes.push('Add a voice-over or music. Silent Reels usually hold fewer viewers.');
    } else {
      if (stats.silentShare > 0.5) {
        score -= 35;
        notes.push(`About ${Math.round(stats.silentShare * 100)}% of the Reel is silent.`);
        fixes.push('Fill silent stretches with voice, music or sound effects.');
      }
      if (stats.longestSilence > 2) {
        score -= 15;
        notes.push(`The longest silence lasts ${secs(stats.longestSilence)}.`);
      }
      if (!notes.length) notes.push('Sound runs through the Reel without long gaps.');
    }
    add('audio', 'Audio', score, notes, fixes);
  }

  // Ending.
  {
    let score = 80;
    const notes = [];
    const fixes = [];
    if (stats.averageEnergy && stats.endingEnergy < stats.averageEnergy * 0.6) {
      score = 60;
      notes.push('The Reel fades out at the end.');
      fixes.push('End on the payoff or a clear next step, such as "Comment ORDER" or "Follow for part 2".');
    } else {
      notes.push('The ending keeps its energy.');
    }
    add('ending', 'Ending', score, notes, fixes);
  }

  // Format.
  {
    let score = 90;
    const notes = [`${stats.width}×${stats.height}.`];
    const fixes = [];
    if (stats.isVertical === false) {
      score = 50;
      fixes.push('Export in 9:16 vertical (1080×1920) so the Reel fills the screen.');
    } else if (stats.width && stats.width < 720) {
      score = 70;
      fixes.push('Export at 1080×1920 for a sharper picture.');
    }
    add('format', 'Format and quality', score, notes, fixes);
  }

  // Length.
  {
    const s = stats.seconds ?? 0;
    let score = 85;
    const fixes = [];
    if (s < 7) { score = 55; fixes.push('Very short Reels rarely have room for a payoff. Aim for 15 to 30 seconds.'); }
    else if (s < 15) score = 75;
    else if (s <= 35) score = 85;
    else if (s <= 60) { score = 70; fixes.push('Check whether the idea still works cut to under 35 seconds.'); }
    else { score = 55; fixes.push('Long Reels need strong pacing throughout. Consider splitting into parts.'); }
    const notes = [`${secs(s)} long.`];
    if (bestLength) notes.push(`Your best-performing Reels are ${bestLength}.`);
    add('length', 'Length', score, notes, fixes);
  }

  const overall = clamp(parts.reduce((sum, part) => sum + part.score * WEIGHTS[part.key], 0));
  const fixes = parts.flatMap((part) => part.fixes.map((fix) => ({ part: part.label, fix, score: part.score })))
    .sort((x, y) => x.score - y.score)
    .slice(0, 5)
    .map(({ part, fix }) => ({ part, fix }));
  return { overall, parts, fixes };
}
