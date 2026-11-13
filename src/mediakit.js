// A creator's media kit: a one-page, printable summary for brands, built from a saved audit.
// Text fields such as rates and contact details are editable on the page before printing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const count = (v) => (v == null ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K` : Math.round(v).toLocaleString('en-US'));
const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`);

export function renderMediaKit(report) {
  const client = report.accounts[0];
  const { profile, metrics, audience } = client;
  const byCode = new Map(client.posts.map((post) => [post.shortCode, post]));
  const top = metrics.winners.map((code) => byCode.get(code)).filter((post) => post?.views != null || post?.likes != null).slice(0, 3);
  const logo = readFileSync(path.join(config.publicDir, 'index.html'), 'utf8').match(/<svg class="logo-svg"[\s\S]*?<\/svg>/)?.[0] ?? '';
  const locations = audience?.locationTags?.slice(0, 3).map((tag) => tag.label) ?? [];
  const languages = audience?.commentScripts?.slice(0, 2).map((s) => `${s.label} (${Math.round(s.share * 100)}%)`) ?? [];
  const reach = metrics.viewsPerFollower;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Media kit · @${esc(profile.handle)}</title><link rel="stylesheet" href="/mediakit.css"></head><body>
<div class="toolbar"><p>Click any dashed field to edit it, then save as PDF.</p><button id="print" type="button">Save as PDF</button></div>
<main class="kit">
  <header class="kit-head">
    <div><p class="eyebrow">Media kit</p><h1>${esc(profile.fullName || profile.handle)}</h1><p class="handle">@${esc(profile.handle)}${profile.category ? ` · ${esc(profile.category)}` : ''}</p></div>
    ${top[0]?.thumb ? `<img class="hero-img" src="${esc(top[0].thumb)}" alt="">` : ''}
  </header>
  <p class="bio edit" contenteditable="true">${esc(profile.bio || 'Write two lines about who you are and what you create.')}</p>
  <section class="stats">
    <div><strong>${count(profile.followers)}</strong><span>Followers</span></div>
    <div><strong>${count(metrics.medianViews)}</strong><span>Typical Reel views</span></div>
    <div><strong>${reach == null ? '–' : `${reach.toFixed(reach < 1 ? 2 : 1)}×`}</strong><span>Reach per follower</span></div>
    <div><strong>${pct(metrics.engagementRate)}</strong><span>Engagement rate</span></div>
  </section>
  ${top.length ? `<section><h2>Top content</h2><div class="posts">${top.map((post) => `<figure>${post.thumb ? `<img src="${esc(post.thumb)}" alt="">` : '<div class="ph"></div>'}<figcaption><b>${post.views != null ? `${count(post.views)} views` : `${count(post.likes)} likes`}</b><span>${esc((post.hook || '').slice(0, 70))}</span></figcaption></figure>`).join('')}</div></section>` : ''}
  <section class="two">
    <div><h2>Audience</h2><ul>
      ${locations.length ? `<li>Most-tagged places: ${locations.map(esc).join(', ')}</li>` : ''}
      ${languages.length ? `<li>Comment languages: ${languages.map(esc).join(', ')}</li>` : ''}
      <li class="edit" contenteditable="true">Add age, gender and top cities from your Instagram Insights.</li>
    </ul></div>
    <div><h2>What I offer</h2><ul>
      <li class="edit" contenteditable="true">1 Reel · your rate</li>
      <li class="edit" contenteditable="true">3 Stories · your rate</li>
      <li class="edit" contenteditable="true">Carousel post · your rate</li>
    </ul></div>
  </section>
  <section class="contact"><h2>Let's work together</h2><p class="edit" contenteditable="true">your.email@example.com · +00 00000 00000</p></section>
  <footer class="kit-foot"><span class="logo">${logo}</span><span>Figures from public Instagram data, ${esc(new Date(report.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}.</span></footer>
</main>
<script src="/mediakit.js"></script>
</body></html>`;
}
