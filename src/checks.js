import { median, MIN_SAMPLE } from './metrics.js';

// Scores for the checkpoints the tool can calculate from public data. Each returns a result, or
// nothing when the data can't support a score, so a missing number is never treated as a bad one.
// The bands are starting assumptions, not published benchmarks, and can be adjusted here.

const band = (value, bands) => bands.find(([min]) => value >= min)?.[1] ?? bands.at(-1)[1];
const pct = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

const ACCOUNT_LEVEL_CHECKS = new Set(['1.5', '1.6', '2.1', '2.7', '3.4', '9.7', '9.8', '10.1', '10.2', '13.1', '13.2', '13.3']);

const CTA = /\b(comment|link in bio|follow|dm|save this|share|shop|buy|order|book|tag a|sign up|download|visit|click)\b/i;

const usable = (account) => account.posts.filter((post) => !post.isPinned && post.timestamp);
const engagement = (post) => (post.likes == null || post.comments == null ? null : post.likes + post.comments);

function formatEngagement(account, type) {
  const followers = account.profile.followers;
  if (!followers) return { n: 0, rate: null };
  const rates = usable(account).filter((post) => post.type === type).map(engagement).filter(Number.isFinite).map((value) => value / followers);
  return { n: rates.length, rate: median(rates) };
}

function compareFormat(account, type, label) {
  const own = formatEngagement(account, type);
  const overall = account.metrics.engagementRate;
  if (own.n < MIN_SAMPLE || !overall) return null;
  const ratio = own.rate / overall;
  return {
    score: band(ratio, [[1.2, 85], [0.8, 70], [0.5, 45], [-Infinity, 30]]),
    finding: `${label} earn ${ratio.toFixed(1)}× the account's typical engagement rate, across ${own.n} posts.`,
    fix: ratio < 0.8 ? `Review the best ${label.toLowerCase()} and test that approach, or spend this effort on stronger formats.` : null,
    confidence: own.n >= 6 ? 'medium' : 'low',
  };
}

/** Ranks the audited account among all accounts: first gets 90, last gets 30. */
function rankScore(accounts, valueOf) {
  const values = accounts.map(valueOf);
  if (values[0] == null || values.filter((value) => value != null).length < 2) return null;
  const known = values.filter((value) => value != null);
  const place = known.filter((value) => value > values[0]).length;
  const score = known.length === 1 ? 60 : 90 - (place / (known.length - 1)) * 60;
  return { score: clamp(score), place: place + 1, of: known.length };
}

function mentionCounts(accounts) {
  const handles = accounts.map((account) => account.profile.handle);
  const counts = new Map(handles.map((handle) => [handle, 0]));
  for (const account of accounts) {
    for (const post of account.posts) {
      const text = `${post.caption} ${(post.commentSample ?? []).join(' ')}`.toLowerCase();
      const tagged = [...post.mentions, ...(post.taggedUsers ?? []), ...(post.coauthors ?? [])].map((name) => name.toLowerCase());
      for (const handle of handles) {
        if (handle === account.profile.handle) continue;
        const inText = text.split(`@${handle}`).length - 1;
        const inTags = tagged.filter((name) => name === handle).length;
        counts.set(handle, counts.get(handle) + Math.max(inText, inTags));
      }
    }
  }
  return counts;
}

export function computeAutoChecks(accounts) {
  const client = accounts[0];
  const { profile, metrics, audience, growth, landing } = client;
  const posts = usable(client);
  const results = {};
  const set = (id, result) => { if (result) results[id] = { confidence: 'medium', fix: null, ...result, score: clamp(result.score) }; };

  // Pillar 1
  if (landing) {
    if (!landing.present) {
      set('1.5', { score: 15, finding: 'No link in bio is set.', fix: 'Add one link to the page that best serves the main offer.', confidence: 'high' });
    } else if (landing.platform) {
      set('1.5', {
        score: 45,
        finding: `The link goes to ${landing.platform} rather than a page the business owns.`,
        fix: 'Link to a page you control, so you can direct visitors to the offer and measure the results.',
        confidence: 'medium',
      });
    } else if (landing.ok) {
      const issues = [];
      let score = 85;
      if (!landing.https) { score -= 15; issues.push('it does not use HTTPS'); }
      if (landing.hops > 2) { score -= 10; issues.push(`it redirects ${landing.hops} times`); }
      if (landing.responseMs > 3000) { score -= 20; issues.push(`the server took ${(landing.responseMs / 1000).toFixed(1)}s to respond`); }
      if (!landing.hasUtm) { score -= 10; issues.push('it has no UTM tags'); }
      set('1.5', {
        score,
        finding: `The link opens ${landing.isLinkPage ? 'a link-list page' : 'a website page'}${issues.length ? `, but ${issues.join(', ')}` : ' with no technical problems found'}.`,
        fix: issues.length ? `Fix these link issues: ${issues.join('; ')}.` : null,
        confidence: 'medium',
      });
    }
  }
  if (profile.highlights != null) {
    set('1.6', {
      score: band(profile.highlights, [[6, 85], [3, 70], [1, 50], [-Infinity, 20]]),
      finding: `The profile has ${profile.highlights} Highlights.`,
      fix: profile.highlights < 3 ? 'Add Highlights for reviews, pricing, FAQs and how it works.' : null,
      confidence: 'low',
    });
  }

  // Pillar 2
  if (growth?.status === 'ready' && growth.series.length >= 2 && growth.series[0].followers) {
    const days = Math.max((new Date(growth.series.at(-1).takenAt) - new Date(growth.series[0].takenAt)) / 86_400_000, 1);
    const rate = (growth.netGain / growth.series[0].followers) * (90 / days);
    set('2.1', {
      score: band(rate, [[0.15, 90], [0.07, 75], [0.02, 55], [0, 35], [-Infinity, 15]]),
      finding: `Followers changed by ${growth.netGain >= 0 ? '+' : ''}${growth.netGain} over ${Math.round(days)} tracked days, about ${pct(rate, 1)} per 90 days.`,
      fix: rate < 0.02 ? 'Find what drove past follower jumps and repeat it.' : null,
      confidence: days >= 30 ? 'high' : 'low',
    });
  }
  const intent = audience?.intent;
  if (metrics.engagementRate != null && intent?.sampled >= 10) {
    const emojiShare = intent.emojiOnly / intent.sampled;
    const unexplained = growth?.spikes?.filter((spike) => spike.confidence === 'unexplained').length ?? 0;
    let score = 80;
    const signs = [];
    if (metrics.engagementRate < 0.002 && profile.followers > 10_000) { score -= 35; signs.push('very low engagement for its size'); }
    if (emojiShare > 0.6) { score -= 20; signs.push(`${pct(emojiShare)} of sampled comments are emoji only`); }
    if (unexplained) { score -= 15; signs.push(`${unexplained} follower jump${unexplained === 1 ? '' : 's'} with no post nearby`); }
    set('2.3', {
      score,
      finding: signs.length ? `Possible warning signs: ${signs.join('; ')}.` : 'No obvious warning signs in public data.',
      fix: signs.length ? 'Review recent followers by hand and avoid giveaway-led growth.' : null,
      confidence: 'low',
    });
  }
  if (profile.followers && profile.following != null) {
    const ratio = profile.following / profile.followers;
    set('2.7', {
      score: band(-ratio, [[-1, 90], [-2, 70], [-5, 45], [-Infinity, 25]]),
      finding: `Follows ${profile.following.toLocaleString('en-US')} accounts with ${profile.followers.toLocaleString('en-US')} followers.`,
      fix: ratio > 2 ? 'Reduce the number of accounts followed.' : null,
      confidence: 'high',
    });
  }

  // Pillar 3
  if (metrics.mix.length) {
    const strong = metrics.mix.filter((entry) => entry.share >= 0.1);
    set('3.3', {
      score: band(strong.length, [[3, 85], [2, 70], [-Infinity, 40]]),
      finding: `Feed mix: ${metrics.mix.map((entry) => `${entry.label} ${pct(entry.share)}`).join(', ')}.`,
      fix: strong.length < 2 ? 'Add a second format, since each one does a different job in the funnel.' : null,
      confidence: 'high',
    });
  }
  if (metrics.postsPerWeek != null) {
    const base = band(metrics.postsPerWeek, [[3, 90], [2, 75], [1, 50], [-Infinity, 25]]);
    const longGap = metrics.longestGapDays > 7;
    set('3.4', {
      score: base - (longGap ? 15 : 0),
      finding: `${metrics.postsPerWeek.toFixed(1)} posts per week, with a longest gap of ${metrics.longestGapDays.toFixed(0)} days.`,
      fix: longGap || metrics.postsPerWeek < 2 ? 'Set a rhythm you can sustain, and avoid gaps longer than 7 days.' : null,
      confidence: 'high',
    });
  }

  // Pillar 4
  const moving = posts.filter((post) => post.views != null);
  if (metrics.viewsPerFollower != null && moving.length >= MIN_SAMPLE) {
    const sorted = [...moving].sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp));
    const half = sorted.length >> 1;
    const older = median(sorted.slice(0, half).map((post) => post.views));
    const newer = median(sorted.slice(half).map((post) => post.views));
    const trend = sorted.length >= 8 && older ? newer / older : null;
    set('4.1', {
      score: band(metrics.viewsPerFollower, [[1, 90], [0.5, 75], [0.2, 55], [0.05, 35], [-Infinity, 20]]) + (trend == null ? 0 : trend > 1.2 ? 5 : trend < 0.8 ? -10 : 0),
      finding: `A typical Reel gets ${Math.round(metrics.medianViews).toLocaleString('en-US')} views, or ${metrics.viewsPerFollower.toFixed(2)}× followers.${trend == null ? '' : ` Recent Reels get ${trend.toFixed(1)}× the views of earlier ones.`}`,
      fix: metrics.viewsPerFollower < 0.5 ? 'Reels are not travelling far beyond followers, so work on hooks and shareable topics.' : null,
      confidence: 'medium',
    });
  }
  const shareRates = moving.filter((post) => post.shares != null && post.views).map((post) => post.shares / post.views);
  if (shareRates.length >= MIN_SAMPLE) {
    const rate = median(shareRates);
    set('4.5', {
      score: band(rate, [[0.01, 90], [0.005, 75], [0.002, 50], [0.0005, 30], [-Infinity, 15]]),
      finding: `A typical Reel gets ${pct(rate, 2)} shares per view, across ${shareRates.length} Reels.`,
      fix: rate < 0.005 ? 'Make more content people would send to one specific friend.' : null,
      confidence: 'medium',
    });
  }
  const viewRates = moving.filter((post) => engagement(post) != null && post.views).map((post) => engagement(post) / post.views);
  if (viewRates.length >= MIN_SAMPLE) {
    const rate = median(viewRates);
    set('4.7', {
      score: band(rate, [[0.06, 90], [0.03, 75], [0.015, 55], [0.005, 35], [-Infinity, 20]]),
      finding: `A typical Reel gets ${pct(rate, 1)} likes and comments per view.`,
      fix: rate < 0.03 ? 'Give viewers something to react to, such as an opinion or direct question.' : null,
      confidence: 'high',
    });
  }
  const ranked = moving.filter((post) => post.perf != null);
  if (ranked.length >= 5) {
    const highs = ranked.filter((post) => post.perf >= 2);
    const lows = ranked.filter((post) => post.perf <= 0.5);
    const share = highs.length / ranked.length;
    set('4.10', {
      score: band(share, [[0.1, 85], [0.04, 65], [-Infinity, 40]]),
      finding: `${highs.length} of ${ranked.length} Reels reached at least twice the typical views, and ${lows.length} fell to half or less.`,
      fix: highs.length ? 'Repeat what your top Reels share, as shown in the content teardown.' : 'No clear breakouts yet, so test bolder hooks and topics.',
      confidence: 'high',
    });
  }

  // Pillar 5
  const lengths = metrics.breakdowns.duration.filter((row) => !row.lowSample && row.value != null);
  if (lengths.length >= 2) {
    const best = lengths.reduce((x, y) => (y.value > x.value ? y : x));
    const common = lengths.reduce((x, y) => (y.n > x.n ? y : x));
    const aligned = common.value >= best.value * 0.8;
    set('5.4', {
      score: aligned ? 85 : 55,
      finding: best.label === common.label
        ? `${best.label} Reels perform best at ${best.value.toFixed(1)}× typical views, and most Reels are already this length.`
        : `${best.label} Reels perform best at ${best.value.toFixed(1)}× typical views, while most Reels are ${common.label} at ${common.value.toFixed(1)}×.`,
      fix: aligned ? null : `Test more ${best.label} Reels.`,
      confidence: 'medium',
    });
  }

  // Pillar 6
  set('6.1', compareFormat(client, 'carousel', 'Carousels'));
  set('6.3', compareFormat(client, 'image', 'Single images'));

  // Pillar 7
  if (metrics.engagementRate != null) {
    set('7.1', {
      score: band(metrics.engagementRate, [[0.03, 90], [0.015, 75], [0.007, 55], [0.003, 35], [-Infinity, 20]]),
      finding: `Median engagement rate is ${pct(metrics.engagementRate, 2)} of followers.`,
      fix: metrics.engagementRate < 0.015 ? 'Focus on the formats and topics with the highest engagement in the breakdowns.' : null,
      confidence: 'medium',
    });
  }
  if (intent?.sampled >= 10) {
    const share = intent.emojiOnly / intent.sampled;
    set('7.2', {
      score: band(-share, [[-0.25, 85], [-0.5, 65], [-0.75, 45], [-Infinity, 25]]),
      finding: `${pct(share)} of ${intent.sampled} sampled comments are emoji only, ${intent.questions} ask questions and ${intent.buyingIntent} relate to buying${intent.keywordReplies ? `, while ${intent.keywordReplies} repeat a comment-prompt keyword` : ''}.`,
      fix: share >= 0.5 ? 'End posts with a specific question to prompt real replies.' : null,
      confidence: 'medium',
    });
  }

  // Pillar 8
  if (posts.length >= MIN_SAMPLE) {
    const count = median(posts.map((post) => post.hashtags.length));
    const sets = posts.filter((post) => post.hashtags.length).map((post) => [...post.hashtags].map((tag) => tag.toLowerCase()).sort().join(' '));
    const repeated = sets.length ? 1 - new Set(sets).size / sets.length : 0;
    let score = 45;
    if (count >= 1 && count <= 8) score = 85;
    else if (count > 8 && count <= 15) score = 65;
    set('8.2', {
      score: score - (repeated > 0.5 ? 10 : 0),
      finding: `Posts typically use ${count} hashtags, and ${pct(repeated)} repeat an identical set.`,
      fix: count === 0 || count > 8 || repeated > 0.5 ? 'Use a few specific, relevant hashtags that vary by post.' : null,
      confidence: 'low',
    });

    const altKnown = posts.filter((post) => post.alt !== undefined);
    const customAlt = altKnown.filter((post) => post.alt && !/^(photo|image|video) (by|shared by)|^may be/i.test(post.alt)).length;
    const located = posts.filter((post) => post.location).length;
    set('8.3', {
      score: 35 + (customAlt / Math.max(altKnown.length, 1)) * 30 + Math.min(located / posts.length, 0.5) * 70,
      finding: `${customAlt} of ${altKnown.length} posts have custom alt text, and ${located} of ${posts.length} have a location tag.`,
      fix: located / posts.length < 0.2 ? 'If you serve specific places, tag locations and write alt text with natural keywords.' : null,
      confidence: 'medium',
    });

    const collabs = posts.filter((post) => post.coauthors?.length || post.taggedUsers?.length).length;
    const share = collabs / posts.length;
    set('8.5', {
      score: band(share, [[0.1, 85], [0.01, 65], [-Infinity, 35]]),
      finding: `${collabs} of ${posts.length} posts include a collaborator or tagged account.`,
      fix: share < 0.1 ? 'Plan a regular collab post with a creator, partner or customer.' : null,
      confidence: 'medium',
    });

    // Pillar 9
    const asking = posts.filter((post) => CTA.test(post.caption)).length / posts.length;
    set('9.4', {
      score: band(asking, [[0.6, 90], [0.3, 70], [0.1, 45], [-Infinity, 25]]),
      finding: `${pct(asking)} of captions ask the viewer to do something.`,
      fix: asking < 0.3 ? 'End more posts with one clear next step tied to the goal of the post.' : null,
      confidence: 'medium',
    });
  }

  if (landing?.platform) {
    set('9.8', {
      score: 25,
      finding: `The bio link goes to ${landing.platform}, so UTM tags and website analytics can't record visits there.`,
      fix: 'Send Instagram traffic to a page with analytics, using UTM tags.',
      confidence: 'medium',
    });
  } else if (landing?.present && landing.ok) {
    let score = 80;
    const issues = [];
    if (!landing.hasViewport) { score -= 30; issues.push('no mobile viewport setting'); }
    if (landing.responseMs > 3000) { score -= 20; issues.push('a slow server response'); }
    if (landing.isLinkPage) { score -= 10; issues.push('an extra link-list step before the offer'); }
    set('9.7', {
      score,
      finding: `Server responded in ${(landing.responseMs / 1000).toFixed(1)}s${issues.length ? `, with ${issues.join(', ')}` : ', and the page is set up for mobile'}.`,
      fix: issues.length ? `Improve the landing page: ${issues.join(', ')}.` : null,
      confidence: 'low',
    });
    const signals = [landing.hasUtm && 'UTM tags', landing.hasMetaPixel && 'Meta Pixel', landing.hasAnalytics && 'an analytics tool'].filter(Boolean);
    set('9.8', {
      score: band(signals.length, [[3, 85], [2, 65], [1, 45], [-Infinity, 25]]),
      finding: signals.length ? `Found ${signals.join(', ')} on the bio link.` : 'No UTM tags, Pixel or analytics found on the bio link.',
      fix: signals.length < 3 ? 'Add UTM tags to the bio link, and confirm analytics and the Pixel are recording Instagram visits.' : null,
      confidence: 'low',
    });
    set('13.2', {
      score: landing.hasMetaPixel ? 80 : 35,
      finding: landing.hasMetaPixel ? 'A Meta Pixel was found on the link page.' : `No Meta Pixel was found on the link page${landing.hasTagManager ? ', though a tag manager may load one' : ''}.`,
      fix: landing.hasMetaPixel ? 'Confirm with the client that purchase events fire, and whether Conversions API is set up.' : 'Confirm with the client, and add a Pixel if there is none.',
      confidence: 'low',
    });
    set('13.3', {
      score: 30 + (landing.hasUtm ? 30 : 0) + (landing.hasAnalytics ? 30 : 0),
      finding: `UTM tags ${landing.hasUtm ? 'found' : 'not found'} on the bio link; analytics ${landing.hasAnalytics ? 'found' : 'not found'} on the page.`,
      fix: landing.hasUtm && landing.hasAnalytics ? null : 'Use consistent UTM tags on every Instagram link, and confirm analytics receives them.',
      confidence: 'low',
    });
  }

  // Pillar 10
  if (accounts.length >= 2) {
    const growthRate = (account) => (account.growth?.status === 'ready' && account.growth.series[0].followers
      ? account.growth.netGain / account.growth.series[0].followers : null);
    const size = rankScore(accounts, (account) => account.profile.followers);
    const growing = rankScore(accounts, growthRate);
    if (size) {
      set('10.1', {
        score: growing ? (size.score + growing.score * 2) / 3 : size.score,
        finding: `Ranks ${size.place} of ${size.of} on followers${growing ? ` and ${growing.place} of ${growing.of} on tracked growth` : ''}.`,
        confidence: growing ? 'medium' : 'low',
      });
    }
    const cadenceRank = rankScore(accounts, (account) => account.metrics.postsPerWeek);
    if (cadenceRank) {
      set('10.2', {
        score: cadenceRank.score,
        finding: `Ranks ${cadenceRank.place} of ${cadenceRank.of} on posts per week.`,
        fix: cadenceRank.place > 1 ? 'Compare your cadence and format mix in the competitor table.' : null,
      });
    }
    const engagementRank = rankScore(accounts, (account) => account.metrics.engagementRate);
    const reachRank = rankScore(accounts, (account) => account.metrics.viewsPerFollower);
    if (engagementRank || reachRank) {
      const scores = [engagementRank, reachRank].filter(Boolean);
      set('10.3', {
        score: scores.reduce((sum, item) => sum + item.score, 0) / scores.length,
        finding: [engagementRank && `Ranks ${engagementRank.place} of ${engagementRank.of} on engagement rate`, reachRank && `${reachRank.place} of ${reachRank.of} on Reel views per follower`].filter(Boolean).join(', ') + '.',
        fix: scores.some((item) => item.place > 1) ? 'Study the top posts of the accounts ahead of you.' : null,
      });
    }
    const counts = mentionCounts(accounts);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (total >= 5) {
      const own = counts.get(profile.handle) / total;
      const fair = 1 / accounts.length;
      set('10.7', {
        score: band(own / fair, [[1.5, 90], [1, 70], [0.5, 45], [-Infinity, 25]]),
        finding: `Gets ${pct(own)} of the ${total} cross-mentions found in the collected posts and comments.`,
        confidence: 'low',
      });
    }
  }

  // Pillar 13
  // Creator accounts are professional accounts too. They report isBusiness as false but still have a category.
  const isProfessional = profile.isBusiness || Boolean(profile.category);
  set('13.1', {
    score: isProfessional ? 80 : 20,
    finding: isProfessional ? `This is a professional account${profile.category ? ` (${profile.category})` : ''}.` : 'This does not appear to be a professional account.',
    fix: isProfessional ? null : 'Switch to a professional account to get Insights.',
    confidence: 'medium',
  });

  // Post-based results rest on very little when an account has hardly posted.
  if (posts.length < 6) {
    for (const [id, result] of Object.entries(results)) {
      if (!ACCOUNT_LEVEL_CHECKS.has(id)) result.confidence = 'low';
    }
  }
  return results;
}
