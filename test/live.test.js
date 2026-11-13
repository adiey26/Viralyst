// Runs the full real-account path against simulated Apify responses, using a temporary data folder.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'insta-audit-test-'));
process.env.DATA_DIR = dataDir;
process.env.APIFY_TOKEN = 'test-token';

const { listReports, loadReport, runLiveAudit } = await import('../src/audit.js');

const DAY = 86_400_000;
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

function reel(handle, i, overrides = {}) {
  return {
    shortCode: `${handle}R${String(i).replace('.', '_')}`,
    type: 'Video',
    productType: 'clips',
    videoUrl: 'https://scontent.cdninstagram.com/reel.mp4',
    caption: `Hook number ${i}?\nMore text #mumbai`,
    hashtags: ['mumbai'],
    likesCount: 100 + i * 10,
    commentsCount: 5 + i,
    videoPlayCount: 1000 * (i + 1),
    videoViewCount: 500,
    videoDuration: 20,
    timestamp: new Date(Date.now() - (i + 3) * DAY).toISOString(),
    displayUrl: 'https://scontent.cdninstagram.com/thumb.jpg',
    ...overrides,
  };
}

function profile(handle, overrides = {}) {
  return {
    username: handle,
    fullName: handle,
    biography: 'Bio',
    followersCount: 5000,
    followsCount: 10,
    postsCount: 100,
    latestPosts: [
      { shortCode: `${handle}R0`, type: 'Video', productType: 'clips', isPinned: true, likesCount: 1, commentsCount: 1, timestamp: new Date(Date.now() - 3 * DAY).toISOString() },
      { shortCode: `${handle}P1`, type: 'Image', likesCount: 80, commentsCount: 2, caption: 'A photo', timestamp: new Date(Date.now() - 4 * DAY).toISOString(), displayUrl: 'https://evil.example/steal.jpg' },
    ],
    ...overrides,
  };
}

let scenario;
let imageRequests;
const fakeVideoReview = async (account, isClient, budget) => { budget.add(`Frame from @${account.profile.handle}`, 'image/jpeg', 'AAAA'); };

function json(body, status = 201) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  imageRequests = [];
  scenario = {
    profile: (input) => json(input.usernames.map((handle) => profile(handle))),
    posts: (input) => json(Array.from({ length: 8 }, (_, i) => reel(input.username[0], i))),
    comments: (input) => json(input.directUrls.flatMap((postUrl) => [{ postUrl, text: 'What is the price?' }, { postUrl, text: 'बहुत बढ़िया' }, { postUrl, text: '🔥' }])),
  };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes('instagram-profile-scraper')) return scenario.profile(JSON.parse(init.body));
    if (target.includes('instagram-post-scraper')) { scenario.lastPostInput = JSON.parse(init.body); return scenario.posts(scenario.lastPostInput); }
    if (target.includes('instagram-reel-scraper')) throw new Error('The Reel scraper should only run when transcripts or shares are on.');
    if (target.includes('instagram-comment-scraper')) return scenario.comments(JSON.parse(init.body));
    imageRequests.push(target);
    return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
});

test('a full audit produces a saved report with metrics, clues, tracking and analysis', async () => {
  let analysisInput;
  const steps = [];
  const analyse = async (report, images) => {
    analysisInput = { report, images };
    return { state: 'done', analysis: { headline: 'Result' }, removedRefs: 1, usage: { estimatedUsd: 0.1 } };
  };
  const report = await runLiveAudit(
    { a: 'alpha', competitors: ['beta'], notes: 'Sells coffee', brief: { goal: 'Sales' }, timezone: 'Asia/Kolkata' },
    (step) => steps.push(step),
    { analyse, checkAi: async () => null, hasAnthropicKey: true, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview },
  );

  const [a, b] = report.accounts;
  assert.equal(report.mode, 'live');
  assert.equal(a.profile.handle, 'alpha');
  assert.equal(b.profile.handle, 'beta');
  assert.ok(steps.length >= 3);

  assert.equal(a.posts.length, 9, 'feed and Reel fetches are merged without duplicates');
  const pinned = a.posts.find((post) => post.shortCode === 'alphaR0');
  assert.equal(pinned.isPinned, true);
  assert.equal(pinned.views, 1000, 'plays are preferred');
  assert.equal(pinned.perf, null, 'pinned posts are not ranked');
  assert.ok(a.metrics.winners.length > 0);

  const winner = a.posts.find((post) => post.shortCode === a.metrics.winners[0]);
  assert.ok(winner.commentSample.includes('What is the price?'));
  assert.ok(winner.audienceHint);
  assert.ok(a.audience.intent.buyingIntent >= 1);
  assert.equal(a.growth.status, 'collecting');
  assert.equal(a.growth.days, 1);
  assert.ok(report.scoreboard.find((row) => row.key === 'buying'));

  assert.ok(analysisInput.images.length > 0);
  assert.equal(analysisInput.images[0].mediaType, 'image/jpeg');
  assert.equal(report.analysis.headline, 'Result');
  assert.ok(report.warnings.some((warning) => /cited 1 post/.test(warning)));

  assert.ok(imageRequests.every((url) => url.includes('cdninstagram.com')), 'non-Instagram image hosts are never contacted');
  assert.ok(winner.thumb.startsWith('/thumbs/'));
  assert.ok(existsSync(path.join(dataDir, 'thumbs')) && readdirSync(path.join(dataDir, 'thumbs')).length > 0);
  assert.equal(a.posts.some((post) => 'thumbUrl' in post), false, 'expiring image links are not stored');

  const saved = loadReport(report.id);
  assert.equal(saved.id, report.id);
  assert.ok(listReports().some((entry) => entry.id === report.id));
  assert.equal(loadReport('../../secret'), null);
});

test('the report still completes when the AI key is missing or the AI call fails', async () => {
  const withoutKey = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.equal(withoutKey.analysis, null);
  assert.equal(withoutKey.analysisStatus.state, 'off');

  const failed = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, {
    hasAnthropicKey: true,
    checkAi: async () => null,
    inspectLink: async () => ({ present: false }),
    reviewVideo: fakeVideoReview,
    analyse: async () => ({ state: 'failed', reason: 'Nope' }),
  });
  assert.equal(failed.analysis, null);
  assert.equal(failed.analysisStatus.reason, 'Nope');
  assert.ok(failed.accounts[0].metrics.winners.length > 0);
});

test('failed Reel or comment fetches become warnings, not a failed audit', async () => {
  scenario.posts = () => json({}, 500);
  scenario.comments = () => json({}, 402);
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.ok(report.warnings.some((warning) => /Posts for @alpha/.test(warning)));
  assert.ok(report.warnings.some((warning) => /only 1 usable posts/.test(warning)));
  assert.equal(report.accounts[0].metrics.medianViews, null);
});

test('private and missing accounts stop the audit with a clear message', async () => {
  scenario.profile = (input) => json(input.usernames.map((handle) => profile(handle, { private: handle === 'beta' })));
  await assert.rejects(runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview }), /@beta is a private account/);

  scenario.profile = () => json([{ error: 'not_found' }]);
  await assert.rejects(runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview }), /was not found/);
});

test('a Claude problem stops the audit before any paid scraping, unless numbers only is chosen', async () => {
  let scrapes = 0;
  const realProfile = scenario.profile;
  scenario.profile = (input) => { scrapes += 1; return realProfile(input); };
  await assert.rejects(
    runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: true, checkAi: async () => 'Your Anthropic account has no credit.' }),
    /no credit.*Numbers only/,
  );
  assert.equal(scrapes, 0);

  let aiCalls = 0;
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta'], skipAi: true }, () => {}, {
    hasAnthropicKey: true,
    checkAi: async () => { aiCalls += 1; return 'No credit'; },
    analyse: async () => { aiCalls += 1; return { state: 'done', analysis: {} }; },
    inspectLink: async () => ({ present: false }),
    reviewVideo: fakeVideoReview,
  });
  assert.equal(aiCalls, 0);
  assert.equal(report.analysisStatus.state, 'off');
  assert.match(report.analysisStatus.reason, /numbers only/);
  assert.ok(report.score.overall != null, 'measured checks still give a score');
});

test('several competitors are all fetched, tracked and benchmarked', async () => {
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta', 'gamma', 'delta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.deepEqual(report.accounts.map((account) => account.profile.handle), ['alpha', 'beta', 'gamma', 'delta']);
  assert.match(report.checks['10.3'].finding, /of 4/);
  assert.ok(report.accounts.every((account) => account.growth.days >= 1));
  assert.equal(report.score.coverage.total, 95);
});

test('no more than 3 scrapers run at once, keeping within Apify plan limits', async () => {
  let active = 0;
  let peak = 0;
  const wrap = (handler) => async (input) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => { setTimeout(resolve, 15); });
    active -= 1;
    return handler(input);
  };
  scenario.profile = wrap(scenario.profile);
  scenario.posts = wrap(scenario.posts);
  scenario.comments = wrap(scenario.comments);
  await runLiveAudit({ a: 'alpha', competitors: ['beta', 'gamma', 'delta', 'epsilon', 'zeta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.ok(peak <= 3, `peak was ${peak}`);
  assert.ok(peak >= 2, 'runs still happen in parallel');
});

test('saved reports from before the framework still get measured checks', async () => {
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  const file = path.join(dataDir, 'reports', `${report.id}.json`);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  delete stored.checks;
  writeFileSync(file, JSON.stringify(stored));
  assert.ok(loadReport(report.id).score.coverage.measured > 0);
});

test('an account with few recent posts gets older posts for patterns, but cadence stays on 90 days', async () => {
  const inputs = [];
  scenario.posts = (input) => {
    inputs.push(input);
    const handle = input.username[0];
    if (handle !== 'alpha') return json(Array.from({ length: 12 }, (_, i) => reel(handle, i)));
    const recent = [reel(handle, 1), reel(handle, 40)];
    const older = Array.from({ length: 10 }, (_, i) => reel(handle, 120 + i * 10));
    return json(input.onlyPostsNewerThan ? recent : [...recent, ...older]);
  };
  scenario.profile = (input) => json(input.usernames.map((handle) => profile(handle, { latestPosts: [] })));
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  const [a] = report.accounts;

  assert.equal(inputs.filter((input) => input.username[0] === 'alpha').length, 2);
  assert.equal(inputs.filter((input) => input.username[0] === 'beta').length, 1, 'an active account needs no extra fetch');
  assert.equal(a.posts.length, 12);
  assert.ok(a.metrics.winners.length > 0, 'there is now enough to rank');
  assert.equal(a.metrics.postsPerWeek, 2 / (90 / 7), 'cadence counts only the 90 days');
  assert.ok(report.warnings.some((warning) => /posted 2 times/.test(warning)));
});

test('hitting the post limit is reported with the period actually covered', async () => {
  scenario.posts = (input) => json(Array.from({ length: 60 }, (_, i) => reel(input.username[0], i / 2)));
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.ok(report.warnings.some((warning) => /limit of 60 posts.*last 33 days/.test(warning)), JSON.stringify(report.warnings));
});

test('a second audit of the same account is compared with the first, including whether fixes worked', async () => {
  const deps = { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview };
  const first = await runLiveAudit({ a: 'progress_co', competitors: ['beta'] }, () => {}, deps);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  scenario.profile = (input) => json(input.usernames.map((handle) => profile(handle, { followersCount: handle === 'progress_co' ? 6000 : 5000 })));
  const second = await runLiveAudit({ a: 'progress_co', competitors: ['beta'] }, () => {}, deps);

  assert.equal(loadReport(first.id).progress, null, 'the first audit has nothing to compare with');
  const progress = loadReport(second.id).progress;
  assert.equal(progress.previousId, first.id);
  const followers = progress.metrics.find((m) => m.key === 'followers');
  assert.equal(followers.before, 5000);
  assert.equal(followers.after, 6000);
  assert.ok(progress.fixes.length > 0);
  assert.ok(progress.fixes.every((fix) => ['improved', 'worse', 'unchanged', 'unknown'].includes(fix.status)));
});

test('creator audits can run without similar creators, and are scored with creator weights', async () => {
  const report = await runLiveAudit({ a: 'solo_creator', competitors: [], audienceType: 'creator' }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.equal(report.audienceType, 'creator');
  assert.equal(report.accounts.length, 1);
  assert.deepEqual(report.scoreboard, []);
  assert.equal(report.score.mode, 'creator');
  assert.ok(!report.score.pillars.some((p) => p.id === 12 || p.id === 13), 'brand-safety and tracking pillars are left out for creators');
  assert.equal(report.score.pillars.find((p) => p.id === 10).title, 'Similar creators');
  assert.equal(report.score.coverage.total, report.score.pillars.reduce((sum, p) => sum + p.totalCount, 0));
});

test('related accounts Instagram suggests are kept for competitor suggestions', async () => {
  scenario.profile = (input) => json(input.usernames.map((handle) => profile(handle, { relatedProfiles: [{ username: 'Local_Rival', full_name: 'Local Rival', is_private: false }, { username: 'hidden', is_private: true }] })));
  const report = await runLiveAudit({ a: 'alpha', competitors: ['beta'] }, () => {}, { hasAnthropicKey: false, inspectLink: async () => ({ present: false }), reviewVideo: fakeVideoReview });
  assert.deepEqual(report.accounts[0].profile.relatedProfiles.map((p) => p.handle), ['local_rival']);
});
