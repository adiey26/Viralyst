// Turns a saved audit into a branded Viralyst PDF for clients.
//
//   npm run pdf -- <report id> [notes.json]
//
// The optional notes file adds an analyst's headline, takeaways and recommendations, for audits
// run without the AI analysis. The PDF is written to the exports folder, which stays off GitHub.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { loadReport } from '../src/audit.js';
import { config } from '../src/config.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [reportId, notesPath] = process.argv.slice(2);
if (!reportId) {
  console.error('Usage: npm run pdf -- <report id> [notes.json]');
  process.exit(1);
}
const report = loadReport(reportId);
if (!report) {
  console.error(`No saved report with id ${reportId}.`);
  process.exit(1);
}
const notes = notesPath ? JSON.parse(readFileSync(notesPath, 'utf8')) : null;

// ---------- helpers ----------
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const count = (v) => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));
const pct = (v, d = 1) => (v == null ? '–' : `${(v * 100).toFixed(d)}%`);
const times = (v) => (v == null ? '–' : `${v.toFixed(v >= 10 ? 0 : v < 1 ? 2 : 1)}×`);
const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const ratingClass = (score) => (score == null ? '' : score >= 85 ? 'strong' : score >= 65 ? 'healthy' : score >= 40 ? 'needs' : 'critical');

// Logo shapes come straight from the site, so the PDF always matches the brand.
const indexHtml = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const wordmark = indexHtml.match(/<svg class="logo-svg"[\s\S]*?<\/svg>/)[0].replace('class="logo-svg"', 'class="wordmark"');
const vMark = indexHtml.match(/<svg class="cta-mark"[\s\S]*?<\/svg>/)[0].replace('class="cta-mark"', 'class="vmark"');

function thumb(post) {
  if (!post?.thumb) return '<div class="thumb empty">No image</div>';
  const file = path.join(config.dataDir, post.thumb.replace(/^\/thumbs\//, 'thumbs/'));
  if (!existsSync(file)) return '<div class="thumb empty">No image</div>';
  const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return `<img class="thumb" src="data:${type};base64,${readFileSync(file).toString('base64')}" alt="">`;
}

function ring(score, size = 150) {
  const c = 2 * Math.PI * 52;
  const v = score ?? 0;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="#f1e2d8" stroke-width="11"/>
    <circle cx="60" cy="60" r="52" fill="none" stroke="#D9482A" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 60 60)"/>
    <text x="60" y="66" text-anchor="middle" font-size="34" font-weight="800" fill="#0B0B0B">${score ?? '–'}</text></svg>`;
}

const bar = (value, max, cls = '') => `<span class="bar ${cls}"><span style="width:${Math.max(2, Math.min(100, (value / max) * 100)).toFixed(1)}%"></span></span>`;

// ---------- data ----------
const [client, ...rivals] = report.accounts;
const main = rivals[0];
const score = report.score;
const handles = report.accounts.map((a) => `@${a.profile.handle}`);
const byCode = (account) => new Map(account.posts.map((p) => [p.shortCode, p]));
const analysis = report.analysis;
const fixes = analysis?.top_10_fixes?.length ? analysis.top_10_fixes : report.fallbackFixes;
const checks = score.pillars.flatMap((p) => p.checks.map((c) => ({ ...c, pillar: p.title })));
const scored = checks.filter((c) => c.score != null);
const missing = checks.filter((c) => c.score == null);
const missingAi = missing.filter((c) => c.source === 'ai');
const missingPrivate = missing.filter((c) => c.source !== 'ai');

// ---------- pages ----------
const pages = [];
let pageNo = 1;
const page = (title, body, { kicker = '', cls = '' } = {}) => {
  pageNo += 1;
  pages.push(`<section class="page ${cls}">
    <header class="ph"><span class="ph-logo">${wordmark}</span><span>Instagram Audit · @${esc(client.profile.handle)}</span></header>
    ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h2>${esc(title)}</h2>
    ${body}
    <footer class="pf"><span>Viral, on purpose.</span><span>${pageNo}</span></footer>
  </section>`);
};

// Cover
pages.push(`<section class="page cover">
  <div class="cover-top">${wordmark}</div>
  <div class="cover-main">
    ${vMark}
    <p class="cover-kicker">Instagram Audit</p>
    <h1>@${esc(client.profile.handle)}</h1>
    <p class="cover-sub">${esc(client.profile.fullName || '')}${rivals.length ? ` · benchmarked against ${rivals.map((a) => `@${esc(a.profile.handle)}`).join(', ')}` : ''}</p>
  </div>
  <div class="cover-meta">
    <div><span>Viralyst Score</span><strong>${score.overall ?? '–'}<small>/100</small></strong></div>
    <div><span>Rating</span><strong class="small">${esc(score.rating?.label ?? 'Not scored')}</strong></div>
    <div><span>Report date</span><strong class="small">${date(report.createdAt)}</strong></div>
  </div>
  <p class="cover-foot">Prepared by Viralyst · Viral, on purpose.</p>
</section>`);

// Executive summary
const headline = notes?.headline ?? analysis?.headline ?? `@${client.profile.handle} scores ${score.overall}/100: ${score.rating?.meaning ?? ''}`;
const summary = notes?.summary ?? analysis?.summary ?? '';
const takeaways = notes?.takeaways ?? [];
page('Executive summary', `
  <div class="exec">
    <div class="exec-score">${ring(score.overall, 170)}<p class="rating ${ratingClass(score.overall)}">${esc(score.rating?.label ?? '')}</p><p class="tiny">${esc(score.rating?.meaning ?? '')}</p></div>
    <div class="exec-text"><p class="headline">${esc(headline)}</p>${summary ? `<p>${esc(summary)}</p>` : ''}</div>
  </div>
  <div class="tiles">
    <div class="tile"><span>Followers</span><strong>${count(client.metrics.followers)}</strong></div>
    <div class="tile"><span>Typical Reel views</span><strong>${count(client.metrics.medianViews)}</strong></div>
    <div class="tile"><span>Reach per follower</span><strong>${times(client.metrics.viewsPerFollower)}</strong></div>
    <div class="tile"><span>Engagement rate</span><strong>${pct(client.metrics.engagementRate, 2)}</strong></div>
    <div class="tile"><span>Posts per week</span><strong>${client.metrics.postsPerWeek?.toFixed(1) ?? '–'}</strong></div>
  </div>
  ${takeaways.length ? `<h3>Key takeaways</h3><ol class="takeaways">${takeaways.map((t) => `<li><strong>${esc(t.title)}</strong><span>${esc(t.detail)}</span></li>`).join('')}</ol>` : ''}
`, { kicker: 'At a glance' });

// Score by area
page('Score by area', `
  <p class="lead">Each of the 13 areas is weighted by how strongly it affects growth and revenue.</p>
  <table class="areas">${score.pillars.map((p) => `<tr>
    <td class="a-name">${p.id}. ${esc(p.title)}<small>${p.weight}% of score</small></td>
    <td class="a-bar">${p.score == null ? '<span class="bar empty"><span></span></span>' : bar(p.score, 100, ratingClass(p.score))}</td>
    <td class="a-score ${ratingClass(p.score)}">${p.score ?? '–'}</td>
    <td class="a-cov">${p.scoredCount}/${p.totalCount} checks</td></tr>`).join('')}</table>
  <p class="coverage">This score is based on <b>${score.coverage.scored} of ${score.coverage.total}</b> checks (${score.coverage.measured} measured from public data, ${score.coverage.ai} AI-reviewed, ${score.coverage.entered} from private Insights). Checks without data are left out, never guessed, so the score is provisional until the rest are added.</p>
  <div class="legend-row"><span><i class="dot strong"></i>85–100 Strong</span><span><i class="dot healthy"></i>65–84 Healthy</span><span><i class="dot needs"></i>40–64 Needs work</span><span><i class="dot critical"></i>0–39 Critical</span><span><i class="dot none"></i>– No data yet</span></div>
`, { kicker: 'The Viralyst Score' });

// Competitor comparison
if (main) {
  const rows = [
    ['Followers', (a) => count(a.metrics.followers)],
    ['Typical Reel views', (a) => count(a.metrics.medianViews)],
    ['Reel views per follower', (a) => times(a.metrics.viewsPerFollower)],
    ['Engagement rate', (a) => pct(a.metrics.engagementRate, 2)],
    ['Posts per week', (a) => a.metrics.postsPerWeek?.toFixed(1) ?? '–'],
    ['Longest gap between posts', (a) => (a.metrics.longestGapDays == null ? '–' : `${Math.round(a.metrics.longestGapDays)} days`)],
    ['Content mix', (a) => a.metrics.mix.map((m) => `${m.label} ${Math.round(m.share * 100)}%`).join(', ')],
    ['Comments about price or buying', (a) => (a.audience?.intent?.sampled >= 10 ? `${pct(a.audience.intent.buyingIntent / a.audience.intent.sampled, 0)} of ${a.audience.intent.sampled}` : '–')],
    ['Bio link', (a) => (!a.landing?.present ? 'None' : a.landing.platform ?? (a.landing.ok ? (a.landing.isLinkPage ? 'Link-list page' : 'Own website') : 'Could not check'))],
  ];
  page('How you compare', `
    <table class="compare"><thead><tr><th></th>${report.accounts.map((a, i) => `<th class="${i === 0 ? 'you' : ''}">@${esc(a.profile.handle)}${i === 0 ? '<small>You</small>' : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><td>${label}</td>${report.accounts.map((a, i) => `<td class="${i === 0 ? 'you' : ''}">${esc(fn(a))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${notes?.comparison?.length ? `<div class="callouts">${notes.comparison.map((c) => `<div class="callout"><strong>${esc(c.title)}</strong><p>${esc(c.detail)}</p></div>`).join('')}</div>` : ''}
    <p class="tiny">Public data. Engagement rate is median likes plus comments divided by followers. ${report.warnings?.filter((w) => /limit of|older posts/.test(w)).map(esc).join(' ') ?? ''}</p>
  `, { kicker: 'Competitor benchmark' });
}

// Best and worst posts
const postCard = (p, account) => `<div class="post">${thumb(p)}<div>
  <p class="perf ${p.perf >= 1 ? 'up' : 'down'}">${times(p.perf)} typical</p>
  <p class="hook">${esc(clip(p.hook || 'No caption', 95))}</p>
  <p class="stats">${[p.views != null && `${count(p.views)} views`, `${count(p.likes)} likes`, p.duration != null && `${Math.round(p.duration)}s`, shortDate(p.timestamp)].filter(Boolean).join(' · ')}</p></div></div>`;
const cMap = byCode(client);
page('Your best and worst posts', `
  <p class="lead">Ranked against your own typical post, so size doesn't skew the comparison.</p>
  <div class="two"><div><h3 class="good-h">Best performers</h3>${client.metrics.winners.slice(0, 4).map((c) => postCard(cMap.get(c), client)).join('')}</div>
  <div><h3 class="bad-h">Weakest performers</h3>${client.metrics.losers.slice(0, 3).map((c) => postCard(cMap.get(c), client)).join('')}
  ${notes?.postsInsight ? `<div class="callout dark"><strong>What separates them</strong><p>${esc(notes.postsInsight)}</p></div>` : ''}</div></div>
`, { kicker: 'Content performance' });

// What drives performance
const bucketBlock = (title, rows) => {
  const shown = rows.filter((r) => r.n > 0);
  const max = Math.max(1, ...shown.map((r) => r.value ?? 0));
  return `<div class="driver"><h4>${esc(title)}</h4>${shown.map((r) => `<div class="drow ${r.lowSample ? 'low' : ''}"><span>${esc(r.label)}</span>${bar(r.value ?? 0, max)}<b>${times(r.value)}</b><small>${r.n} post${r.n === 1 ? '' : 's'}</small></div>`).join('')}</div>`;
};
const b = client.metrics.breakdowns;
page('What drives your performance', `
  <p class="lead">How each group of posts did against your typical post (1× = typical). Faded rows rest on fewer than 3 posts, so treat them as hints.</p>
  <div class="drivers">${bucketBlock('Reel length', b.duration)}${bucketBlock('Time of day posted', b.timeOfDay)}${bucketBlock('Call to action in caption', b.callToAction)}${bucketBlock('Question in the opening line', b.question)}</div>
  ${notes?.driversInsight ? `<div class="callout"><strong>The pattern</strong><p>${esc(notes.driversInsight)}</p></div>` : ''}
`, { kicker: 'Patterns' });

// Audience
const intent = client.audience.intent;
page('Audience and comments', `
  <div class="tiles three">
    <div class="tile"><span>Comments sampled</span><strong>${intent.sampled}</strong></div>
    <div class="tile"><span>Emoji-only comments</span><strong>${pct(intent.emojiOnly / Math.max(intent.sampled, 1), 0)}</strong></div>
    <div class="tile"><span>About price or buying</span><strong>${intent.buyingIntent}</strong></div>
  </div>
  <div class="two">
    <div><h3>Where the audience appears to be</h3><ul class="clean">${[
      client.audience.locationTags.length && `Location tags used: ${client.audience.locationTags.slice(0, 4).map((t) => `${esc(t.label)} (${t.count})`).join(', ')}`,
      ...client.audience.commentScripts.slice(0, 2).map((s) => `${Math.round(s.share * 100)}% of comments with words are in ${esc(s.label)}`),
    ].filter(Boolean).map((t) => `<li>${t}</li>`).join('')}</ul>
    <p class="tiny">Instagram doesn't publish views by country. These are clues, not measurements.</p></div>
    <div>${notes?.audienceInsight ? `<div class="callout"><strong>What it tells us</strong><p>${esc(notes.audienceInsight)}</p></div>` : ''}</div>
  </div>
`, { kicker: 'Audience' });

// Recommendations
const recs = notes?.recommendations ?? fixes.map((f) => ({ title: f.fix, detail: f.why, impact: f.impact, effort: f.effort }));
chunks(recs.slice(0, 10), 5).forEach((group, index) => page(index ? 'What to do next (continued)' : 'What to do next', `
  ${index ? '' : '<p class="lead">In priority order: the biggest impact for the least effort first.</p>'}
  <ol class="recs" start="${index * 5 + 1}" style="counter-reset: r ${index * 5}">${group.map((r) => `<li><div><strong>${esc(r.title)}</strong><p>${esc(r.detail)}</p>${r.how ? `<p class="how"><b>First step:</b> ${esc(r.how)}</p>` : ''}</div>${r.impact ? `<span class="pill-tag">${esc(r.impact)} impact${r.effort ? ` · ${esc(r.effort)} effort` : ''}</span>` : ''}</li>`).join('')}</ol>
`, { kicker: 'Action plan' }));

// Detailed checks
chunks(scored, 14).forEach((group, index) => page(index ? 'Detailed findings (continued)' : 'Detailed findings', `
  ${index ? '' : '<p class="lead">Every check scored in this audit, with what the data showed.</p>'}
  <table class="checks">${group.map((c) => `<tr><td class="c-id">${c.id}</td><td><strong>${esc(c.title)}</strong><span>${esc(c.finding ?? '')}</span></td><td class="c-score ${ratingClass(c.score)}">${c.score}</td></tr>`).join('')}</table>
`, { kicker: 'Scorecard' }));

// Next steps and method
page('Completing the audit', `
  <div class="two">
    <div><h3>Still to add (${missing.length} checks)</h3>
      ${missingAi.length ? `<p><b>${missingAi.length} checks need the AI creative review</b>, such as the bio, hooks, first frames, content pillars and brand voice.</p>` : ''}
      ${missingPrivate.length ? `<p><b>${missingPrivate.length} checks need private Insights or answers from the team</b>, such as reach, skip rate, retention, saves, Stories, DMs, ads and Account Status.</p>` : ''}
      <p class="tiny">Adding them makes the score final. Missing checks by area:</p>
      <ul class="clean cols tiny-list">${[...new Set(missing.map((c) => c.pillar))].map((p) => `<li>${esc(p)}: ${missing.filter((c) => c.pillar === p).length}</li>`).join('')}</ul></div>
    <div><h3>How this audit was made</h3><ul class="clean">
      <li>Public posts from the last ${report.reviewDays ?? 90} days, comments on the best and worst posts, and the bio link were collected.</li>
      <li>Sampled video frames were measured for length, format and cuts per 10 seconds.</li>
      <li>${report.analysisStatus?.state === 'done' ? 'An AI review assessed creative and strategy checks.' : 'This report was run on measured data only. The AI creative review was not included.'}</li>
      <li>Scoring bands follow the Viralyst framework. Missing data is excluded, never estimated.</li>
    </ul></div>
  </div>
  <div class="contact">${vMark}<div><p class="contact-title">Want the full audit?</p><p>Viralyst can add the AI creative review, a profile rewrite and a 30-60-90 day plan.</p><p class="contact-line">connect.viralyst@gmail.com · @viralyst.t</p></div></div>
`, { kicker: 'Next steps' });

// ---------- document ----------
const css = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color: #0B0B0B; font-size: 10.5pt; line-height: 1.45; }
.page { position: relative; width: 210mm; height: 297mm; padding: 20mm 18mm 18mm; page-break-after: always; overflow: hidden; background: #FFFAF6; }
.page:last-child { page-break-after: auto; }
.ph { display: flex; justify-content: space-between; align-items: center; font-size: 8.5pt; color: #6f6660; border-bottom: 1px solid #efe3da; padding-bottom: 6mm; margin: -6mm 0 8mm; }
.ph-logo .wordmark { height: 16px; width: auto; color: #0B0B0B; display: block; }
.pf { position: absolute; left: 18mm; right: 18mm; bottom: 10mm; display: flex; justify-content: space-between; font-size: 8pt; color: #9a8b82; border-top: 1px solid #efe3da; padding-top: 3mm; }
.kicker { color: #BC3A1E; font-weight: 800; font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 2mm; }
h2 { font-size: 24pt; letter-spacing: -.03em; margin: 0 0 5mm; line-height: 1.1; }
h3 { font-size: 12pt; margin: 6mm 0 3mm; }
h4 { font-size: 10.5pt; margin: 0 0 3mm; }
p { margin: 0 0 3mm; }
.lead { color: #3d3733; font-size: 11pt; margin-bottom: 6mm; }
.tiny { font-size: 8.5pt; color: #6f6660; }
small { display: block; font-size: 8pt; color: #6f6660; font-weight: 500; }

.cover { background: #D9482A; color: #0B0B0B; display: flex; flex-direction: column; padding: 22mm 20mm; }
.cover-top .wordmark { height: 30px; width: auto; color: #0B0B0B; }
.cover-top .wordmark path[fill="#D9482A"] { fill: #FFF4EE; }
.cover-main { margin-top: 38mm; }
.cover .vmark { width: 34mm; height: auto; display: block; margin-bottom: 10mm; }
.cover-kicker { font-weight: 800; letter-spacing: .14em; text-transform: uppercase; font-size: 11pt; margin-bottom: 3mm; }
.cover h1 { font-size: 46pt; letter-spacing: -.04em; line-height: 1; margin: 0 0 5mm; word-break: break-word; }
.cover-sub { font-size: 13pt; color: #2a1208; max-width: 150mm; }
.cover-meta { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; }
.cover-meta div { background: rgba(255, 244, 238, .92); border-radius: 5mm; padding: 5mm 6mm; }
.cover-meta span { display: block; font-size: 8.5pt; font-weight: 700; color: #6f2a17; text-transform: uppercase; letter-spacing: .06em; }
.cover-meta strong { font-size: 30pt; letter-spacing: -.03em; }
.cover-meta strong small { display: inline; font-size: 12pt; color: #6f6660; }
.cover-meta strong.small { font-size: 15pt; display: block; margin-top: 2mm; }
.cover-foot { margin: 8mm 0 0; font-size: 9pt; color: #2a1208; }

.exec { display: grid; grid-template-columns: 52mm 1fr; gap: 8mm; align-items: center; background: #fff; border: 1px solid #efe3da; border-radius: 5mm; padding: 6mm; }
.exec-score { text-align: center; }
.rating { font-weight: 800; font-size: 13pt; margin: 1mm 0 0; }
.headline { font-size: 14pt; font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3mm; margin: 6mm 0; }
.tiles.three { grid-template-columns: repeat(3, 1fr); }
.tile { background: #fff; border: 1px solid #efe3da; border-radius: 4mm; padding: 4mm; }
.tile span { display: block; font-size: 8pt; color: #6f6660; font-weight: 600; }
.tile strong { font-size: 17pt; letter-spacing: -.02em; }
.takeaways { margin: 0; padding: 0; list-style: none; counter-reset: t; display: grid; gap: 3mm; }
.takeaways li { counter-increment: t; position: relative; padding: 3.5mm 4mm 3.5mm 13mm; background: #fff; border-radius: 4mm; border-left: 3px solid #D9482A; }
.takeaways li::before { content: counter(t); position: absolute; left: 4mm; top: 3.5mm; width: 6mm; height: 6mm; border-radius: 50%; background: #D9482A; color: #fff; font-weight: 800; font-size: 8.5pt; display: flex; align-items: center; justify-content: center; }
.takeaways strong { display: block; }
.takeaways span { color: #3d3733; font-size: 9.5pt; }
.coverage { margin-top: 5mm; font-size: 8.5pt; color: #6f6660; background: #fbf0e8; border-radius: 3mm; padding: 3mm 4mm; }

.areas { width: 100%; border-collapse: collapse; }
.areas td { padding: 2mm 0; border-bottom: 1px solid #efe3da; vertical-align: middle; }
.a-name { width: 62mm; font-weight: 600; }
.a-bar { padding-right: 4mm !important; }
.a-score { width: 12mm; text-align: right; font-weight: 800; font-size: 12pt; }
.a-cov { width: 24mm; text-align: right; font-size: 8pt; color: #6f6660; }
.bar { display: block; height: 3mm; background: #f1e2d8; border-radius: 2mm; overflow: hidden; }
.bar > span { display: block; height: 100%; border-radius: 2mm; background: #D9482A; }
.bar.strong > span { background: #1f9d55; } .bar.healthy > span { background: #2a78d6; } .bar.needs > span { background: #e8a33a; } .bar.critical > span { background: #d0362c; }
.bar.empty > span { width: 0; }
.strong { color: #1f9d55; } .healthy { color: #2a78d6; } .needs { color: #c27c0e; } .critical { color: #d0362c; }
.legend-row { display: flex; flex-wrap: wrap; gap: 5mm; margin-top: 5mm; font-size: 8.5pt; color: #3d3733; }
.dot { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 50%; margin-right: 1.5mm; vertical-align: middle; }
.dot.strong { background: #1f9d55; } .dot.healthy { background: #2a78d6; } .dot.needs { background: #e8a33a; } .dot.critical { background: #d0362c; } .dot.none { background: #dccbbf; }

.compare { width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #efe3da; border-radius: 4mm; overflow: hidden; }
.compare th, .compare td { padding: 3mm 4mm; text-align: left; border-bottom: 1px solid #f3e8e0; font-size: 9.5pt; }
.compare tr:last-child td { border-bottom: 0; }
.compare th { background: #0B0B0B; color: #FFF4EE; font-size: 10pt; }
.compare th.you { background: #D9482A; color: #0B0B0B; }
.compare th small { color: inherit; opacity: .8; }
.compare td:first-child { color: #6f6660; font-weight: 600; width: 50mm; }
.compare td.you { background: #fff4ee; font-weight: 700; }
.callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 6mm 0 4mm; }
.callout { background: #fff; border: 1px solid #efe3da; border-left: 3px solid #D9482A; border-radius: 4mm; padding: 4mm 5mm; margin-top: 4mm; }
.callouts .callout { margin-top: 0; }
.callout strong { display: block; margin-bottom: 1mm; }
.callout p { margin: 0; color: #3d3733; font-size: 9.5pt; }
.callout.dark { background: #0B0B0B; border-color: #0B0B0B; }
.callout.dark strong { color: #FFF4EE; } .callout.dark p { color: #e2d6ce; }

.two { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }
.good-h { color: #1f9d55; margin-top: 0; } .bad-h { color: #d0362c; margin-top: 0; }
.post { display: grid; grid-template-columns: 22mm 1fr; gap: 3.5mm; background: #fff; border: 1px solid #efe3da; border-radius: 4mm; padding: 3mm; margin-bottom: 3mm; }
.thumb { width: 22mm; height: 28mm; object-fit: cover; border-radius: 2.5mm; background: #f1e2d8; }
.thumb.empty { display: flex; align-items: center; justify-content: center; font-size: 7pt; color: #9a8b82; }
.post p { margin: 0 0 1mm; }
.perf { font-weight: 800; font-size: 11pt; } .perf.up { color: #1f9d55; } .perf.down { color: #d0362c; }
.hook { font-size: 9pt; line-height: 1.35; }
.stats { font-size: 8pt; color: #6f6660; }

.drivers { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.driver { background: #fff; border: 1px solid #efe3da; border-radius: 4mm; padding: 4mm 5mm; }
.drow { display: grid; grid-template-columns: 32mm 1fr 12mm 14mm; gap: 2mm; align-items: center; font-size: 9pt; padding: 1.4mm 0; }
.drow b { text-align: right; } .drow small { text-align: right; }
.drow.low { opacity: .45; }

.clean { margin: 0; padding-left: 5mm; } .clean li { margin-bottom: 2mm; }
.clean.cols { columns: 2; font-size: 9pt; }
.tiny-list { font-size: 8.5pt; color: #3d3733; }
.tiny-list li { margin-bottom: 1mm; }
.recs { list-style: none; counter-reset: r; padding: 0; margin: 0; display: grid; gap: 3.5mm; }
.recs li { counter-increment: r; position: relative; display: flex; justify-content: space-between; gap: 4mm; background: #fff; border: 1px solid #efe3da; border-radius: 4mm; padding: 4mm 5mm 4mm 15mm; }
.recs li::before { content: counter(r); position: absolute; left: 4.5mm; top: 4mm; width: 7mm; height: 7mm; border-radius: 50%; background: #D9482A; color: #0B0B0B; font-weight: 800; display: flex; align-items: center; justify-content: center; font-size: 9pt; }
.recs strong { display: block; font-size: 11pt; margin-bottom: 1mm; }
.recs p { margin: 0 0 1mm; color: #3d3733; font-size: 9.5pt; }
.recs .how { color: #6f2a17; font-size: 9pt; }
.pill-tag { flex: none; align-self: flex-start; font-size: 7.5pt; font-weight: 700; background: #fde6dc; color: #BC3A1E; border-radius: 99px; padding: 1mm 2.5mm; white-space: nowrap; }

.checks { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
.checks td { padding: 1.9mm 1.5mm; border-bottom: 1px solid #efe3da; vertical-align: top; }
.checks strong { display: block; }
.checks span { color: #3d3733; }
.c-id { width: 10mm; color: #9a8b82; font-weight: 700; }
.c-score { width: 10mm; text-align: right; font-weight: 800; font-size: 10.5pt; }

.contact { position: absolute; left: 18mm; right: 18mm; bottom: 20mm; display: flex; gap: 7mm; align-items: center; background: #D9482A; border-radius: 6mm; padding: 7mm 8mm; }
.contact .vmark { width: 22mm; height: auto; flex: none; }
.contact p { margin: 0 0 1mm; color: #2a1208; }
.contact-title { font-size: 16pt; font-weight: 800; color: #0B0B0B !important; letter-spacing: -.02em; }
.contact-line { font-weight: 700; color: #0B0B0B !important; margin-top: 2mm !important; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Viralyst Instagram Audit · @${esc(client.profile.handle)}</title><style>${css}</style></head><body>${pages.join('\n')}</body></html>`;

// ---------- render ----------
const exportsDir = path.join(ROOT, 'exports');
mkdirSync(exportsDir, { recursive: true });
const base = `Viralyst-Instagram-Audit-${client.profile.handle.replace(/[^\w.-]/g, '_')}`;
const htmlFile = path.join(exportsDir, `${base}.html`);
const pdfFile = path.join(exportsDir, `${base}.pdf`);
writeFileSync(htmlFile, html);

const browsers = [
  path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((file) => file && existsSync(file));
if (!browsers.length) {
  console.log(`No Edge or Chrome found. Open ${htmlFile} in a browser and print it to PDF.`);
  process.exit(0);
}
const profile = path.join(os.tmpdir(), `viralyst-pdf-${process.pid}`);
try {
  await run(browsers[0], ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--no-pdf-header-footer', '--print-to-pdf-no-header', `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href], { timeout: 120_000 });
} finally {
  // The browser can hold its temporary folder open for a moment, so clean-up never fails the export.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Left for the system to clear from the temp folder.
  }
}
console.log(`Saved ${pdfFile} (${pages.length} pages)`);
