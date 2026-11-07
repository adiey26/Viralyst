import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import { ANALYSIS_SCHEMA, cleanCheckpoints } from '../src/analysis.js';
import { computeAutoChecks } from '../src/checks.js';
import { analyzeVideo, countCuts, isAllowedMediaUrl, parseStreamInfo, sampleTimes } from '../src/frames.js';
import { AI_CHECK_IDS, ALL_CHECKS, PILLARS, ratingFor, scoreFromNumber } from '../src/framework.js';
import { checkLanding, inspectHtml, isPrivateAddress } from '../src/landing.js';
import { computeScore, fallbackFixes, validateInput } from '../src/score.js';

test('the framework matches the PDF: 13 pillars, 95 checks and weights totalling 100', () => {
  assert.equal(PILLARS.length, 13);
  assert.equal(ALL_CHECKS.length, 95);
  assert.equal(new Set(ALL_CHECKS.map((item) => item.id)).size, 95);
  assert.equal(PILLARS.reduce((sum, pillar) => sum + pillar.weight, 0), 100);
  assert.deepEqual(PILLARS.map((pillar) => pillar.weight), [8, 8, 10, 14, 10, 8, 8, 8, 10, 6, 4, 4, 2]);
  assert.deepEqual(PILLARS.map((pillar) => pillar.checks.length), [9, 7, 8, 10, 10, 8, 8, 7, 8, 7, 4, 5, 4]);
});

test('the score bands match the PDF', () => {
  assert.equal(ratingFor(85).label, 'Strong');
  assert.equal(ratingFor(84).label, 'Healthy');
  assert.equal(ratingFor(65).label, 'Healthy');
  assert.equal(ratingFor(64).label, 'Needs work');
  assert.equal(ratingFor(40).label, 'Needs work');
  assert.equal(ratingFor(39).label, 'Critical');
});

test('number inputs score correctly in both directions', () => {
  const skip = ALL_CHECKS.find((item) => item.id === '4.2').input;
  assert.equal(scoreFromNumber(skip, 25), 90);
  assert.equal(scoreFromNumber(skip, 45), 70);
  assert.equal(scoreFromNumber(skip, 90), 25);
  const saves = ALL_CHECKS.find((item) => item.id === '4.6').input;
  assert.equal(scoreFromNumber(saves, 2), 90);
  assert.equal(scoreFromNumber(saves, 0), 15);
});

test('missing data is left out of the score instead of counting as zero', () => {
  const empty = computeScore({});
  assert.equal(empty.overall, null);
  assert.equal(empty.coverage.scored, 0);

  const one = computeScore({ checks: { '2.7': { score: 80, finding: 'x' } } });
  assert.equal(one.overall, 80, 'one scored pillar is rescaled, not diluted by empty pillars');
  assert.equal(one.coverage.scored, 1);
  assert.equal(one.pillars[0].score, null);
  assert.equal(one.pillars[1].score, 80);
  assert.equal(one.coverage.measured, 1);
});

test('the overall score uses pillar weights', () => {
  const score = computeScore({ checks: { '4.1': { score: 100 }, '13.1': { score: 0 } } }); // Weights 14 and 2.
  assert.equal(score.overall, Math.round((100 * 14) / 16));
  assert.equal(score.rating.label, 'Strong');
});

test('an auditor entry overrides an automatic or AI result', () => {
  const report = {
    checks: { '2.7': { score: 80 } },
    analysis: { checkpoints: [{ id: '1.3', can_assess: true, score: 40, finding: 'AI', evidence: '', fix: '', confidence: 'low', post_refs: [] }] },
    inputs: { '2.7': { rating: 'critical', note: 'Checked' }, '1.3': { rating: 'strong', note: '' }, '4.6': { value: 2, note: '' } },
  };
  const checks = computeScore(report).pillars.flatMap((pillar) => pillar.checks);
  const by = Object.fromEntries(checks.map((item) => [item.id, item]));
  assert.equal(by['2.7'].score, 20);
  assert.equal(by['2.7'].provenance, 'entered');
  assert.equal(by['2.7'].note, 'Checked');
  assert.equal(by['1.3'].score, 90);
  assert.equal(by['4.6'].score, 90);
  assert.match(by['4.6'].finding, /2%/);
});

test('AI checkpoints it cannot assess stay unscored, and scores are kept within range', () => {
  const report = { analysis: { checkpoints: [
    { id: '1.2', can_assess: false, score: 0, finding: 'No photo', evidence: '', fix: '', confidence: 'low', post_refs: [] },
    { id: '1.3', can_assess: true, score: 180, finding: 'x', evidence: '', fix: '', confidence: 'low', post_refs: [] },
  ] } };
  const by = Object.fromEntries(computeScore(report).pillars.flatMap((pillar) => pillar.checks).map((item) => [item.id, item]));
  assert.equal(by['1.2'].score, null);
  assert.equal(by['1.2'].finding, 'No photo');
  assert.equal(by['1.3'].score, 100);
});

test('the AI can only answer AI checkpoints, once each', () => {
  const clean = cleanCheckpoints({ checkpoints: [{ id: '1.3', score: 1 }, { id: '1.3', score: 2 }, { id: '4.2', score: 99 }, { id: '99', score: 99 }] });
  assert.deepEqual(clean.checkpoints, [{ id: '1.3', score: 1 }]);
  assert.deepEqual(ANALYSIS_SCHEMA.properties.checkpoints.items.properties.id.enum, AI_CHECK_IDS);
});

test('auditor input is validated', () => {
  assert.deepEqual(validateInput('4.2', { value: '35', note: ' ok ' }), { value: 35, note: 'ok' });
  assert.deepEqual(validateInput('12.1', { rating: 'healthy' }), { rating: 'healthy', note: '' });
  assert.equal(validateInput('12.1', null), null);
  assert.throws(() => validateInput('99.9', { rating: 'strong' }), /Unknown/);
  assert.throws(() => validateInput('12.1', { value: 5 }), /needs a number/);
  assert.throws(() => validateInput('4.2', { value: 'abc' }), /needs a number/);
  assert.throws(() => validateInput('12.1', { rating: 'amazing' }), /choose a rating/);
  assert.equal(validateInput('12.1', { rating: 'strong', note: 'x'.repeat(900) }).note.length, 500);
});

test('fallback fixes favour heavily weighted, low-scoring checks with a fix', () => {
  const score = computeScore({ checks: {
    '4.7': { score: 20, fix: 'Reels fix', finding: 'a' },
    '13.1': { score: 20, fix: 'Tracking fix', finding: 'b' },
    '2.7': { score: 90, fix: 'Already strong', finding: 'c' },
    '3.4': { score: 30, fix: null, finding: 'd' },
  } });
  assert.deepEqual(fallbackFixes(score).map((item) => item.fix), ['Reels fix', 'Tracking fix']);
});

const DAY = 86_400_000;
function account(handle, over = {}) {
  const posts = Array.from({ length: 12 }, (_, i) => ({
    shortCode: `${handle}${i}`, type: 'reel', caption: i % 2 ? 'Comment PRICE below #coffee' : 'Nice morning', hashtags: ['coffee'], mentions: [], taggedUsers: [], coauthors: [],
    likes: 100, comments: 10, views: 1000 * (i + 1), duration: 20, timestamp: new Date(Date.now() - (i + 3) * DAY).toISOString(), location: i === 0 ? 'Pune' : null,
    isPinned: false, alt: null, perf: (i + 1) / 6.5, commentSample: [],
  }));
  return {
    profile: { handle, followers: 5000, following: 100, highlights: 2, isBusiness: true, category: null },
    posts,
    landing: { present: false },
    audience: { intent: { sampled: 20, emojiOnly: 15, questions: 2, buyingIntent: 1 } },
    growth: { status: 'collecting', days: 1, spikes: [], series: [] },
    metrics: {
      engagementRate: 0.02, viewsPerFollower: 1.2, medianViews: 6000, postsPerWeek: 3, longestGapDays: 3, mix: [{ label: 'Reel', n: 12, share: 1 }],
      breakdowns: { duration: [] },
    },
    ...over,
  };
}

test('automatic checks produce scores, and skip what the data cannot support', () => {
  const results = computeAutoChecks([account('alpha'), account('beta', { metrics: { ...account('beta').metrics, engagementRate: 0.05, viewsPerFollower: 2, postsPerWeek: 1 } })]);
  assert.equal(results['1.5'].score, 15, 'no bio link');
  assert.equal(results['2.7'].score, 90);
  assert.equal(results['3.3'].score, 40, 'one format');
  assert.equal(results['4.1'].score, 80, 'strong reach, lowered because recent Reels get fewer views');
  assert.equal(results['7.2'].score, 45, '75% emoji comments is the edge of that band');
  assert.equal(results['9.4'].score, 70, 'half of captions ask for action');
  assert.equal(results['10.3'].score, 30, 'behind the competitor on both');
  assert.equal(results['10.2'].score, 90, 'ahead on cadence');
  assert.equal(results['2.1'], undefined, 'no growth score without tracking');
  assert.equal(results['6.1'], undefined, 'no carousel score without carousels');
  assert.equal(results['13.2'], undefined, 'no pixel verdict without a page');
  for (const result of Object.values(results)) assert.ok(result.score >= 0 && result.score <= 100 && result.finding);
});

test('creator accounts count as professional, and other-platform links are handled fairly', () => {
  const creator = account('alpha');
  creator.profile.isBusiness = false;
  creator.profile.category = 'Fitness Trainer';
  assert.equal(computeAutoChecks([creator, account('beta')])['13.1'].score, 80);
  creator.profile.category = null;
  assert.equal(computeAutoChecks([creator, account('beta')])['13.1'].score, 20);

  const youtube = account('alpha', { landing: { present: true, ok: false, status: 404, platform: 'YouTube' } });
  const results = computeAutoChecks([youtube, account('beta')]);
  assert.match(results['1.5'].finding, /YouTube/);
  assert.equal(results['1.5'].score, 45);
  assert.equal(results['9.8'].score, 25);
  assert.equal(results['9.7'], undefined);
  assert.equal(results['13.2'], undefined, 'no Pixel verdict for a page the business does not own');

  const unreadable = account('alpha', { landing: { present: true, ok: false, error: 'The page took too long to respond.' } });
  assert.equal(computeAutoChecks([unreadable, account('beta')])['1.5'], undefined, 'an unreadable link is checked by hand, not marked down');
});

test('results resting on very few posts are marked low confidence, and two Reels are not called typical', () => {
  const thin = account('alpha');
  thin.posts = thin.posts.slice(0, 2);
  const results = computeAutoChecks([thin, account('beta')]);
  assert.equal(results['4.1'], undefined);
  assert.equal(results['7.1'].confidence, 'low');
  assert.equal(results['2.7'].confidence, 'high', 'account-level facts stay firm');
});

test('every automatic result belongs to the framework', () => {
  const ids = new Set(ALL_CHECKS.map((item) => item.id));
  const results = computeAutoChecks([account('alpha'), account('beta')]);
  for (const id of Object.keys(results)) assert.ok(ids.has(id), id);
});

test('private addresses are blocked for bio links', () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1', 'nonsense']) {
    assert.ok(isPrivateAddress(address), address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(address), address);
});

test('checkLanding refuses a link or redirect to a private address', async () => {
  const publicDns = async () => [{ address: '93.184.216.34' }];
  const direct = await checkLanding('http://127.0.0.1/admin', { resolve: publicDns, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.match(direct.error, /private address/);
  const rebound = await checkLanding('https://evil.example/', { resolve: async () => [{ address: '10.0.0.1' }], fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.match(rebound.error, /private address/);

  let calls = 0;
  const redirect = await checkLanding('https://good.example/', {
    resolve: publicDns,
    fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }); },
  });
  assert.match(redirect.error, /private address/);
  assert.equal(calls, 1);
  assert.match((await checkLanding('ftp://example.com/', { resolve: publicDns })).error, /Unsupported/);
  assert.deepEqual(await checkLanding(null), { present: false });
});

test('checkLanding follows redirects and reads what the page reveals', async () => {
  const pages = {
    'https://l.example/go?utm_source=ig': new Response(null, { status: 301, headers: { location: 'https://shop.example/' } }),
    'https://shop.example/': new Response('<title>Shop</title><meta name="viewport" content="x"><script src="https://connect.facebook.net/en_US/fbevents.js"></script><a href="https://wa.me/1">Chat</a><p>Add to cart</p>', { status: 200, headers: { 'content-type': 'text/html' } }),
  };
  const result = await checkLanding('https://l.example/go?utm_source=ig', { resolve: async () => [{ address: '93.184.216.34' }], fetchImpl: async (url) => pages[url] });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://shop.example/');
  assert.equal(result.hops, 1);
  assert.equal(result.hasUtm, true);
  assert.equal(result.hasMetaPixel, true);
  assert.equal(result.hasCheckout, true);
  assert.equal(result.hasLeadCapture, true);
  assert.equal(result.title, 'Shop');
});

test('checkLanding recognises links to other platforms', async () => {
  const result = await checkLanding('https://youtube.com/@channel', {
    resolve: async () => [{ address: '142.250.0.1' }],
    fetchImpl: async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(result.platform, 'YouTube');
  assert.equal((await checkLanding('https://shop.example/', { resolve: async () => [{ address: '93.184.216.34' }], fetchImpl: async () => new Response('ok') })).platform, null);
});

test('inspectHtml strips scripts from page text', () => {
  const page = inspectHtml('<script>steal()</script><style>a{}</style><p>Hello <b>there</b></p>');
  assert.equal(page.text, 'Hello there');
  assert.equal(page.hasViewport, false);
});

test('video helpers read ffmpeg output and refuse other hosts', () => {
  const log = 'Duration: 00:00:21.50, start: 0\n Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n Stream #0:1: Audio: aac\n';
  assert.deepEqual(parseStreamInfo(log), { width: 1080, height: 1920, isVertical: true, hasAudio: true, seconds: 21.5 });
  assert.equal(parseStreamInfo('Stream #0:0: Video: h264, 1280x720').isVertical, false);
  assert.equal(countCuts('n:0 pts_time:1.2\nn:1 pts_time:3.4\n'), 2);
  assert.deepEqual(sampleTimes(20), [0, 1, 3, 10, 19]);
  assert.deepEqual(sampleTimes(2), [0, 1]);
  assert.ok(isAllowedMediaUrl('https://scontent.cdninstagram.com/a.mp4'));
  assert.ok(!isAllowedMediaUrl('https://evil.example/a.mp4'));
});

test('a real video is measured: one cut, vertical format, no audio, frames extracted', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'insta-audit-clip-'));
  const realFetch = globalThis.fetch;
  try {
    const clip = path.join(dir, 'clip.mp4');
    execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=360x640:d=3', '-f', 'lavfi', '-i', 'color=blue:s=360x640:d=3',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[out]', '-map', '[out]', '-pix_fmt', 'yuv420p', clip]);
    globalThis.fetch = async () => new Response(readFileSync(clip), { status: 200 });

    const { frames, stats } = await analyzeVideo('https://scontent.cdninstagram.com/clip.mp4');
    assert.equal(stats.cuts, 1);
    assert.equal(stats.width, 360);
    assert.equal(stats.height, 640);
    assert.equal(stats.isVertical, true);
    assert.equal(stats.hasAudio, false);
    assert.ok(Math.abs(stats.seconds - 6) < 0.5);
    assert.equal(frames.length, 4, 'in a 6-second clip the midpoint and 3-second samples are the same moment');
    assert.ok(frames.every((frame) => frame.mediaType === 'image/jpeg' && frame.data.length > 100));
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
