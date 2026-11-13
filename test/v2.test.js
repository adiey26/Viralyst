import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import ffmpegPath from 'ffmpeg-static';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'viralyst-v2-'));
process.env.DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = 'test-key';
after(() => rmSync(dataDir, { recursive: true, force: true }));

const { accountContext, chatAboutReport, cleanChatMessages, generateIdeas, reviewReel, writeBrandPitch, writeScript } = await import('../src/assistant.js');
const { checkLinkedReel, checkUploadedReel, listReelChecks, loadReelCheck, parseReelLink, reviewFrameTimes } = await import('../src/reelchecks.js');
const { renderMediaKit } = await import('../src/mediakit.js');
const { runDemoAudit, loadReport } = await import('../src/audit.js');

const report = loadReport((await runDemoAudit({ timezone: 'Asia/Kolkata', audienceType: 'creator' })).id);

/** A stand-in for the Anthropic client that records the request and returns a fixed reply. */
function fakeClient(payload, capture = {}) {
  return {
    beta: {
      messages: {
        create: async (params) => {
          capture.params = params;
          return { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] };
        },
      },
    },
  };
}

test('the account summary sent to the AI is compact and mode-aware', () => {
  const context = accountContext(report);
  assert.equal(context.mode, 'creator');
  assert.equal(context.account.handle, report.accounts[0].profile.handle);
  assert.ok(context.bestPosts.length > 0);
  assert.ok(JSON.stringify(context).length < 40_000, 'small enough to keep requests cheap');
});

test('chat answers from the report, keeps scraped data inside a marked block, and checks the history', async () => {
  const capture = {};
  const { reply } = await chatAboutReport(report, [{ role: 'user', content: 'Why did my last reel flop?' }], { client: fakeClient('Because the hook starts late.', capture) });
  assert.equal(reply, 'Because the hook starts late.');
  assert.match(capture.params.messages[0].content, /^<account_data>/);
  assert.match(capture.params.system, /growth coach speaking directly to a creator/);
  assert.equal(capture.params.fallbacks, 'default');
  assert.throws(() => cleanChatMessages([]), /type a question/);
  assert.throws(() => cleanChatMessages([{ role: 'assistant', content: 'hi' }]), /type a question/);
  const trimmed = cleanChatMessages(Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })));
  assert.ok(trimmed.length <= 20, 'long histories are trimmed');
  assert.equal(trimmed[0].role, 'user', 'a trimmed history still starts with the user');
  assert.equal(trimmed.at(-1).content, 'm30');
});

test('ideas drop references to posts that do not exist', async () => {
  const real = report.accounts[0].metrics.winners[0];
  const { ideas } = await generateIdeas(report, { topic: 'coffee' }, { client: fakeClient({ ideas: [{ title: 'A', hook: 'B', format: 'Reel', length_seconds: 20, why: 'C', based_on_refs: [real, 'invented'] }] }) });
  assert.deepEqual(ideas[0].based_on_refs, [real]);
});

test('scripts and brand pitches return structured results and validate input', async () => {
  const script = { title: 'T', hook_line: 'H', on_screen_text: 'O', beats: [{ at_seconds: 0, visual: 'V', line: 'L' }], caption: 'C', call_to_action: 'A', hashtags: ['#x'], filming_notes: 'N' };
  assert.equal((await writeScript(report, { title: 'Brew guide', hook: 'Stop', format: 'Reel' }, { client: fakeClient(script) })).script.hook_line, 'H');
  await assert.rejects(writeScript(report, '', { client: fakeClient(script) }), /describe the post/);
  const capture = {};
  const pitch = await writeBrandPitch(report, { brand: 'Acme Coffee', product: 'Cold brew' }, { client: fakeClient({ subject: 'S', message: 'M', follow_up: 'F', numbers_used: ['61,500 followers'] }, capture) });
  assert.equal(pitch.pitch.subject, 'S');
  assert.match(capture.params.messages[0].content, /Acme Coffee/);
  await assert.rejects(writeBrandPitch(report, { brand: '' }, { client: fakeClient({}) }), /brand name/);
});

test('AI errors become readable messages', async () => {
  const refusing = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: {} }) } } };
  await assert.rejects(chatAboutReport(report, [{ role: 'user', content: 'hi' }], { client: refusing }), /declined/);
  const broken = fakeClient('not json');
  await assert.rejects(generateIdeas(report, {}, { client: broken }), /could not be read/);
});

test('Reel links are recognised and frame times favour the opening', () => {
  assert.equal(parseReelLink('https://www.instagram.com/reel/ABC123/?igsh=x').url, 'https://www.instagram.com/reel/ABC123/');
  assert.equal(parseReelLink('https://instagram.com/p/XYZ/').url, 'https://www.instagram.com/p/XYZ/');
  assert.throws(() => parseReelLink('https://evil.example/reel/ABC'), /Instagram Reel/);
  assert.deepEqual(reviewFrameTimes(20).slice(0, 5), [0, 0.5, 1, 2, 3]);
  assert.ok(reviewFrameTimes(4).every((t) => t < 4));
});

function makeClip(dir) {
  const clip = path.join(dir, 'draft.mp4');
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=360x640:d=3:r=30', '-f', 'lavfi', '-i', 'color=blue:s=360x640:d=5:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=8',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-pix_fmt', 'yuv420p', '-shortest', clip]);
  return clip;
}

test('an uploaded draft is measured, scored, reviewed by AI and saved for comparison', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'draft-'));
  try {
    let reviewInput;
    const review = async (input) => {
      reviewInput = input;
      return { review: { overall_score: 77, summary: 'Good', parts: [], fixes: [], new_hooks: ['a', 'b', 'c'], cta_ideas: ['x', 'y'] }, usage: { estimatedUsd: 0.01 } };
    };
    const check = await checkUploadedReel(makeClip(dir), { name: 'Version 1', audienceType: 'creator', useAi: true }, () => {}, { review });
    assert.equal(check.name, 'Version 1');
    assert.equal(check.stats.cuts, 1);
    assert.equal(check.stats.hook.soundStart, 0);
    assert.equal(check.feedback.parts.length, 6);
    assert.equal(check.ai.review.overall_score, 77);
    assert.ok(reviewInput.frames.length >= 5, 'several frames go to the AI, weighted to the opening');
    assert.equal(loadReelCheck(check.id).id, check.id);
    assert.ok(listReelChecks().some((item) => item.id === check.id && item.measured === check.feedback.overall));

    const noAi = await checkUploadedReel(makeClip(dir), { name: 'Version 2', useAi: false }, () => {}, { review });
    assert.equal(noAi.ai, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a posted Reel is fetched by link, and a post without video gives a clear message', async () => {
  const analyse = async (url, options) => {
    assert.equal(url, 'https://scontent.cdninstagram.com/v.mp4');
    assert.equal(typeof options.frameTimes, 'function');
    return { frames: [], stats: { seconds: 10, width: 1080, height: 1920, isVertical: true, hasAudio: true, cutsPer10Seconds: 3, hook: { soundStart: 0, firstMovement: 0, openingEnergy: 0.5 }, averageEnergy: 0.5, endingEnergy: 0.5, silentShare: 0, longestSilence: 0, weakestStretch: null } };
  };
  const check = await checkLinkedReel('https://www.instagram.com/reel/ABC/', { useAi: false }, () => {}, { fetchPost: async () => [{ videoUrl: 'https://scontent.cdninstagram.com/v.mp4' }], analyse });
  assert.equal(check.source, 'link');
  assert.equal(check.name, 'Reel ABC');
  await assert.rejects(checkLinkedReel('https://www.instagram.com/p/IMG/', { useAi: false }, () => {}, { fetchPost: async () => [{ type: 'Image' }], analyse }), /no video/);
});

test('the AI Reel review keeps scores in range', async () => {
  const { review } = await reviewReel({ stats: { seconds: 10, timeline: [{ t: 0, energy: 1 }] }, feedback: {}, frames: [] }, { client: fakeClient({ overall_score: 140, summary: 's', parts: [{ part: 'Hook', score: -5, comment: 'c' }], fixes: [], new_hooks: [], cta_ideas: [] }) });
  assert.equal(review.overall_score, 100);
  assert.equal(review.parts[0].score, 0);
});

test('the media kit is built from the report and escapes account text', () => {
  const tricky = structuredClone(report);
  tricky.accounts[0].profile.bio = '<script>alert(1)</script>';
  const html = renderMediaKit(tricky);
  assert.match(html, /Media kit/);
  assert.match(html, /Typical Reel views/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
