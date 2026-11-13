import { growthChart, pairedBars, timelineChart, viewsScatter } from './charts.js';

const $ = (id) => document.getElementById(id);

// Motion for the home page and reports. Everything is decorative, and none of it runs
// when the visitor's system asks for reduced motion.

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts a number up from zero, easing out so it settles gently. */
function countUp(node) {
  const target = Number(node.dataset.countTo);
  if (reducedMotion()) {
    node.textContent = String(target);
    return;
  }
  const duration = 1400;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = String(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Half-circle gauges fill to their value; the SVG path length is normalised to 100. */
function fillGauge(path) {
  const value = Number(path.dataset.gauge);
  path.style.strokeDashoffset = String(100 - value);
}

let observer;

/** Reveals sections, starts counters and fills gauges as each one scrolls into view. */
function watchReveals(root = document) {
  const targets = root.querySelectorAll('.reveal, [data-count-to], [data-gauge]');
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((node) => {
      node.classList.add('in');
      if (node.dataset.countTo) countUp(node);
      if (node.dataset.gauge) fillGauge(node);
    });
    return;
  }
  document.documentElement.classList.add('motion-ready');
  // A safety net: if the observer never fires (a hidden tab, an old browser), show everything anyway.
  setTimeout(() => root.querySelectorAll('.reveal:not(.in)').forEach((node) => {
    if (node.getBoundingClientRect().top < window.innerHeight) node.classList.add('in');
  }), 1500);
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      node.classList.add('in');
      if (node.dataset.countTo && !node.dataset.counted) {
        node.dataset.counted = 'true';
        countUp(node);
      }
      if (node.dataset.gauge) fillGauge(node);
      observer.unobserve(node);
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  targets.forEach((node) => observer.observe(node));
}

/** The striped "equaliser" band under the hero, built here so each bar gets its own rhythm. */
function buildBars(container, count = 96) {
  if (!container || container.childElementCount) return;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const bar = document.createElement('span');
    const wave = Math.sin(i / 6) * 0.5 + 0.5;
    bar.style.height = `${30 + wave * 70}%`;
    bar.style.animationDelay = `${-(i % 24) * 0.11}s`;
    bar.style.animationDuration = `${2.2 + (i % 7) * 0.25}s`;
    fragment.append(bar);
  }
  container.append(fragment);
}

/** The hero preview: the score gauge fills and counts up, then repeats while the home page is open. */
function startHeroPreview() {
  const gauge = document.getElementById('hero-gauge');
  const counter = document.querySelector('.score-float [data-count-to]');
  if (!gauge) return;
  if (reducedMotion()) {
    gauge.style.strokeDashoffset = '28';
    if (counter) counter.textContent = counter.dataset.countTo;
    return;
  }
  if (gauge.dataset.running) return;
  gauge.dataset.running = 'true';
  const cycle = () => {
    gauge.style.strokeDashoffset = '100';
    if (counter) counter.textContent = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      gauge.style.strokeDashoffset = '28';
      if (counter) countUp(counter);
    }));
  };
  cycle();
  setInterval(() => { if (!document.hidden && !document.getElementById('page-home').hidden) cycle(); }, 8000);
}


// Business or creator. The choice is remembered on this device and changes the copy, the form and the score weights.
const MODE_KEY = 'viralyst-mode';
let audienceMode = (() => {
  try {
    return localStorage.getItem(MODE_KEY) === 'creator' ? 'creator' : 'business';
  } catch {
    return 'business';
  }
})();

const CREATOR_PLACEHOLDERS = { 'input-customer': 'Students preparing for exams', 'input-markets': 'India, mainly Hindi speakers', 'input-notes': 'Your niche, brands you have worked with, what you want to be known for…' };
const BUSINESS_PLACEHOLDERS = { 'input-customer': 'Women aged 25 to 40 starting yoga', 'input-markets': 'India, mainly Mumbai and Delhi', 'input-notes': 'What the company sells, current offers, brand guidelines…' };

function setMode(mode) {
  audienceMode = mode === 'creator' ? 'creator' : 'business';
  try {
    localStorage.setItem(MODE_KEY, audienceMode);
  } catch {
    // Private windows can refuse storage; the switch still works for this visit.
  }
  const creator = audienceMode === 'creator';
  document.documentElement.dataset.audience = audienceMode;
  document.querySelectorAll('[data-mode]').forEach((node) => { node.hidden = node.dataset.mode !== audienceMode; });
  document.querySelectorAll('[data-set-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.setMode === audienceMode)));
  document.querySelectorAll('[data-audience-card]').forEach((card) => card.classList.toggle('chosen', card.dataset.audienceCard === audienceMode));
  for (const [id, text] of Object.entries(creator ? CREATOR_PLACEHOLDERS : BUSINESS_PLACEHOLDERS)) $(id).placeholder = text;
  $('hero-handle').placeholder = creator ? 'yourhandle' : 'yourbrand';
  if (!$('hero-handle').value.trim()) $('phone-handle').textContent = creator ? '@yourhandle' : '@yourbrand';
  document.querySelectorAll('.competitor-list .field').forEach((label, i) => {
    if (i) label.querySelector('span').textContent = `${creator ? 'Similar creator' : 'Competitor'} ${i + 1}`;
  });
  document.querySelectorAll('.goal-grid[hidden] input:checked').forEach((input) => { input.checked = false; });
  renderPillarGrid();
  if (wizardStep === 3 && !$('page-new').hidden) renderReview();
}

/** Builds elements with textContent only, so scraped captions and comments can never run as HTML. */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

const count = (value) => (value == null ? '–' : Math.round(value).toLocaleString('en-US'));
const percent = (value) => (value == null ? '–' : `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`);
const FORMATTERS = {
  count,
  percent,
  ratio: (value) => (value == null ? '–' : `${value.toFixed(2)}×`),
  decimal: (value) => (value == null ? '–' : value.toFixed(1)),
  days: (value) => (value == null ? '–' : `${value.toFixed(1)} days`),
};
const multiple = (value) => `${value.toFixed(1)}×`;
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const isInstagramUrl = (url) => typeof url === 'string' && url.startsWith('https://www.instagram.com/');

function who(handle, series) {
  return h('span', { class: 'who' }, h('span', { class: `swatch ${series}`, 'aria-hidden': 'true' }), `@${handle}`);
}

function section(title, intro, ...content) {
  return h('section', { class: 'section' }, h('h2', {}, title), intro && h('p', { class: 'section-intro' }, intro), ...content);
}

function postLink(post, isDemo, label) {
  if (!post) return null;
  if (isDemo || !isInstagramUrl(post.url)) return h('span', {}, label);
  return h('a', { href: post.url, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function renderHonesty() {
  return section('How to read this report', null, h('div', { class: 'honesty' },
    h('div', { class: 'card' }, h('h3', {}, 'Measured'), h('ul', {},
      h('li', {}, 'Followers, likes, comments and Reel views'),
      h('li', {}, 'Captions, hashtags, length, timing and cuts per 10 seconds'),
      h('li', {}, 'Bio link checks, and comment wording from a sample'))),
    h('div', { class: 'card' }, h('h3', {}, 'AI judgement or estimate'), h('ul', {},
      h('li', {}, 'Creative and strategy checks, from covers and sampled frames'),
      h('li', {}, 'Likely audience location, and which post may have driven a follower jump'),
      h('li', {}, 'Why a post worked, labelled as a likely explanation'))),
    h('div', { class: 'card' }, h('h3', {}, 'Needs Insights or the client'), h('ul', {},
      h('li', {}, 'Reach, skip rate, retention, watch time and saves'),
      h('li', {}, 'Views by country and followers gained per post'),
      h('li', {}, 'Stories, DMs, ads, Account Status and security')))));
}

const SOURCE_LABELS = { measured: 'Measured', ai: 'AI judgement', entered: 'Entered by auditor' };
const openPillars = new Set();

function renderScoreHero(report) {
  const { score } = report;
  const { coverage } = score;
  const missing = coverage.total - coverage.scored;
  return section('Score by area', 'Each area is weighted by how strongly it affects growth and revenue. Checks without data are left out, never guessed.',
    h('div', { class: 'card' },
      h('div', {},
        score.rating && h('p', { class: 'score-rating' }, `${score.rating.label}: ${score.rating.meaning}`),
        h('p', { class: 'note' }, `Based on ${coverage.scored} of ${coverage.total} checks: ${coverage.measured} measured, ${coverage.ai} AI judged, ${coverage.entered} entered by you.${missing ? ` ${missing} still need data, so the score is provisional. Add them in the Scorecard tab.` : ''}`)),
      h('div', { class: 'pillars-summary' }, score.pillars.map((pillar) => {
        const fill = h('span');
        fill.style.width = `${pillar.score ?? 0}%`;
        return h('div', { class: 'pillar-row' },
          h('span', {}, `${pillar.id}. ${pillar.title} `, h('span', { class: 'pillar-weight' }, `${pillar.weight}%`)),
          h('span', { class: 'meter', 'aria-hidden': 'true' }, fill),
          h('span', { class: 'pillar-score' }, pillar.score == null ? '–' : String(pillar.score)),
          h('span', { class: 'pillar-count' }, `${pillar.scoredCount} of ${pillar.totalCount} checks`));
      }))));
}

function checkInputForm(report, item) {
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const note = h('input', { 'aria-label': `Note for ${item.title}`, maxlength: '500', placeholder: 'Note (optional)' });
  const number = item.input ? h('input', { type: 'number', step: 'any', 'aria-label': item.input.label, value: report.inputs?.[item.id]?.value ?? '' }) : null;
  const rating = h('select', { 'aria-label': `Rating for ${item.title}` },
    h('option', { value: '' }, 'Choose a rating'),
    h('option', { value: 'strong' }, 'Strong'),
    h('option', { value: 'healthy' }, 'Healthy'),
    h('option', { value: 'needs_work' }, 'Needs work'),
    h('option', { value: 'critical' }, 'Critical'));
  if (report.inputs?.[item.id]?.rating) rating.value = report.inputs[item.id].rating;
  if (report.inputs?.[item.id]?.note) note.value = report.inputs[item.id].note;

  const submit = async (entry) => {
    error.hidden = true;
    try {
      const updated = await api(`/api/reports/${report.id}/inputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: { [item.id]: entry } }),
      });
      const y = window.scrollY;
      loadedReport = updated;
      renderReport(updated, 'scorecard');
      window.scrollTo(0, y);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  };

  return h('div', { class: 'check-input' },
    number
      ? h('label', {}, h('span', {}, `${item.input.label} (${item.input.unit})`), number)
      : h('label', {}, h('span', {}, 'Your rating'), rating),
    h('label', {}, h('span', {}, 'Note'), note),
    h('button', { type: 'button', onclick: () => submit(number ? { value: number.value, note: note.value } : { rating: rating.value, note: note.value }) }, 'Save'),
    report.inputs?.[item.id] && h('button', { type: 'button', onclick: () => submit(null) }, 'Clear'),
    error);
}

function checkNode(report, item) {
  const scored = item.score != null;
  const showForm = !scored || item.provenance === 'entered' || item.source === 'manual' || item.input;
  const tags = [
    scored && h('span', { class: 'tag' }, SOURCE_LABELS[item.provenance]),
    scored && item.confidence && h('span', { class: 'tag' }, `${item.confidence} confidence`),
    scored && renderRefs(report, item.post_refs),
  ];
  return h('div', { class: 'check' },
    h('div', { class: 'check-head' },
      h('span', { class: 'check-title' }, `${item.id} ${item.title}`),
      h('span', { class: `check-score${scored ? '' : ' missing'}` }, scored ? String(item.score) : 'Needs data')),
    h('p', { class: 'why' }, item.lookAt),
    item.finding && h('p', {}, item.finding),
    item.evidence && h('p', { class: 'evidence' }, item.evidence),
    item.note && h('p', { class: 'evidence' }, `Auditor note: ${item.note}`),
    item.fix && h('p', {}, h('strong', {}, 'Fix: '), item.fix),
    scored && h('div', { class: 'tags' }, tags),
    item.partial && h('p', { class: 'limit' }, `Limit: ${item.partial}`),
    !scored && item.hint && h('p', { class: 'limit' }, item.hint),
    showForm && checkInputForm(report, item));
}

function renderScorecard(report) {
  const missing = report.score.coverage.total - report.score.coverage.scored;
  const filterButton = (key, label) => h('button', {
    type: 'button',
    'aria-pressed': String(scorecardFilter === key),
    onclick: () => { scorecardFilter = key; renderReport(report, 'scorecard'); },
  }, label);
  const tools = h('div', { class: 'scorecard-tools' },
    h('p', { class: 'note' }, missing ? `${missing} checks need data from Insights or the client.` : 'Every check has data.'),
    h('div', { class: 'filter-toggle', role: 'group', 'aria-label': 'Show checks' }, filterButton('all', 'All checks'), filterButton('missing', 'Needs data')));
  return h('div', {}, tools,
    report.score.pillars.map((pillar) => {
      const shown = scorecardFilter === 'missing' ? pillar.checks.filter((item) => item.score == null) : pillar.checks;
      const details = h('details', { class: 'pillar', open: openPillars.has(pillar.id) || scorecardFilter === 'missing' ? 'open' : null },
        h('summary', {}, h('span', {}, `${pillar.id}. ${pillar.title}`), h('span', {}, `${pillar.score ?? '–'} · ${pillar.scoredCount} of ${pillar.totalCount} checks`)),
        shown.length ? shown.map((item) => checkNode(report, item)) : h('p', { class: 'checks-hidden-note' }, 'Every check in this area has data.'));
      details.addEventListener('toggle', () => {
        if (details.open) openPillars.add(pillar.id);
        else openPillars.delete(pillar.id);
      });
      return details;
    }));
}

function renderTopFixes(report, limit = 10) {
  const all = report.analysis?.top_10_fixes?.length ? report.analysis.top_10_fixes : report.fallbackFixes;
  if (!all?.length) return null;
  const fixes = all.slice(0, limit);
  const titles = new Map(report.score.pillars.flatMap((pillar) => pillar.checks.map((item) => [item.id, item.title])));
  const isShort = all.length > fixes.length;
  return section(isShort ? `Top ${fixes.length} fixes` : `Top ${fixes.length} fixes`, 'The biggest impact for the least effort, in priority order.', h('div', { class: 'card' },
    h('ol', { class: 'actions-list' }, fixes.map((item) => h('li', {},
      h('strong', {}, item.fix), h('div', {}, item.why),
      item.first_step && h('div', { class: 'note' }, `First step: ${item.first_step}`),
      h('div', { class: 'tags' },
        item.impact && h('span', { class: 'tag' }, `${item.impact} impact`),
        item.effort && h('span', { class: 'tag' }, `${item.effort} effort`),
        titles.get(item.checkpoint_id) && h('span', {}, `Checkpoint ${item.checkpoint_id}: ${titles.get(item.checkpoint_id)}`))))),
    isShort && h('a', { class: 'see-all no-print', href: `#report/${report.id}/plan` }, `See all ${all.length} fixes in the action plan →`)));
}

function renderTeardown(report) {
  const items = report.analysis?.content_teardown;
  if (!items?.length) return null;
  const posts = new Map(report.accounts[0].posts.map((post) => [post.shortCode, post]));
  const group = (verdict, title) => h('div', { class: 'stack' }, h('h3', {}, title), items.filter((item) => item.verdict === verdict && posts.has(item.ref)).map((item) => {
    const post = posts.get(item.ref);
    const measured = post.video?.cutsPer10Seconds != null ? ` Measured: ${post.video.cutsPer10Seconds} cuts per 10 seconds.` : '';
    return h('div', { class: 'card' },
      h('p', {}, h('strong', {}, postLink(post, report.mode === 'demo', post.hook || 'No caption'))),
      h('p', { class: 'post-stats' }, `${count(post.views)} views · ${post.perf != null ? `${multiple(post.perf)} typical` : 'not ranked'}`),
      h('p', {}, h('strong', {}, 'Hook: '), item.hook),
      h('p', {}, h('strong', {}, 'Pacing: '), item.pacing, measured),
      h('p', {}, h('strong', {}, 'Likely drop-off: '), item.likely_drop_off),
      h('p', {}, h('strong', {}, 'Change: '), item.what_to_change));
  }));
  return section('Content teardown', 'Retention data is private, so drop-off points are inferred from sampled frames. Confirm them in Insights.',
    h('div', { class: 'grid-2' }, group('best', 'Best Reels'), group('worst', 'Worst Reels')));
}

function renderBenchmark(report) {
  const accounts = report.accounts;
  const rows = [
    ['Followers', (m) => count(m.followers)],
    ['Tracked growth', (_, a) => (a.growth?.status === 'ready' ? `${a.growth.netGain >= 0 ? '+' : ''}${count(a.growth.netGain)} in ${a.growth.days} days` : `Day ${a.growth?.days ?? 0} of ${a.growth?.requiredDays ?? 7}`)],
    ['Posts per week', (m) => FORMATTERS.decimal(m.postsPerWeek)],
    ['Format mix', (m) => m.mix.map((entry) => `${entry.label} ${Math.round(entry.share * 100)}%`).join(', ') || '–'],
    ['Typical Reel views', (m) => count(m.medianViews)],
    ['Reel views per follower', (m) => FORMATTERS.ratio(m.viewsPerFollower)],
    ['Engagement rate', (m) => percent(m.engagementRate)],
    ['Typical comments', (m) => count(m.medianComments)],
    ['Comments showing buying intent', (_, a) => (a.audience?.intent?.sampled >= 10 ? percent(a.audience.intent.buyingIntent / a.audience.intent.sampled) : '–')],
    ['Comment-prompt replies', (_, a) => (a.audience?.intent?.sampled >= 10 ? percent((a.audience.intent.keywordReplies ?? 0) / a.audience.intent.sampled) : '–')],
    ['Bio link', (_, a) => { if (!a.landing?.present) return 'None'; if (a.landing.platform) return a.landing.platform; if (!a.landing.ok) return 'Could not check'; return a.landing.isLinkPage ? 'Link-list page' : 'Website'; }],
  ];
  const notes = report.analysis?.competitor_notes ?? [];
  const title = accounts.length < 2 ? 'Your public numbers' : isCreator(report) ? 'You and similar creators' : 'Competitor benchmark';
  return section(title, report.reviewDays ? `Public data, aiming for the last ${report.reviewDays} days. Posting figures use that period, and Data notes lists any account covering more or less.` : 'Public data from the posts collected for this report.',
    h('div', { class: 'card table-wrap' }, h('table', { class: 'benchmark' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Measure'), accounts.map((account, i) => h('th', { class: 'num' }, `@${account.profile.handle}${i === 0 ? ' (audited)' : ''}`)))),
      h('tbody', {}, rows.map(([label, value]) => h('tr', {}, h('td', {}, label), accounts.map((account) => h('td', { class: 'num' }, value(account.metrics, account)))))))),
    notes.length > 0 && h('div', { class: 'grid-2 spaced' }, notes.map((item) => h('div', { class: 'card' },
      h('h3', {}, `@${item.handle}`),
      h('p', {}, h('strong', {}, 'Positioning: '), item.positioning),
      h('p', {}, h('strong', {}, 'Offers and cues: '), item.offers_and_cues),
      h('p', {}, h('strong', {}, 'What works: '), item.what_works),
      h('p', {}, h('strong', {}, 'Weakness: '), item.weakness),
      h('div', { class: 'tags' }, renderRefs(report, item.post_refs))))),
    report.mode !== 'demo' && !isCreator(report) && accounts.length > 1 && h('p', { class: 'note spaced' }, 'Check competitor ads in the Meta Ad Library: ',
      accounts.slice(1).flatMap((account, i) => [i ? ', ' : '', h('a', {
        href: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&q=${encodeURIComponent(account.profile.fullName || account.profile.handle)}`,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, `@${account.profile.handle}`)])));
}

function renderProfileRewrite(report) {
  const rewrite = report.analysis?.profile_rewrite;
  if (!rewrite) return null;
  return section('Profile rewrite', 'A suggested starting point. Check every claim before using it.', h('div', { class: 'grid-2' },
    h('div', { class: 'card' },
      h('h3', {}, 'Name field'), h('pre', { class: 'bio' }, rewrite.name_field),
      h('h3', {}, 'Bio'), h('pre', { class: 'bio' }, rewrite.bio)),
    h('div', { class: 'card' },
      h('h3', {}, 'Highlights'), h('ul', { class: 'plan-list' }, rewrite.highlights.map((item) => h('li', {}, h('strong', {}, `${item.title}: `), item.purpose))),
      h('h3', {}, 'Pinned posts'), h('ul', { class: 'plan-list' }, rewrite.pinned_posts.map((item) => h('li', {}, h('strong', {}, `${item.purpose}: `), item.idea))))));
}

function renderPlan306090(report) {
  const plan = report.analysis?.plan_30_60_90;
  if (!plan?.length) return null;
  return section('30-60-90 day plan', null, h('div', { class: 'plan-timeline' }, plan.map((period) => h('div', { class: 'card plan-period' },
    h('h3', {}, `${period.period}: ${period.focus}`),
    h('p', {}, h('strong', {}, 'Content pillars: '), period.content_pillars.join(', ')),
    h('p', {}, h('strong', {}, 'Posting rhythm: '), period.posting_rhythm),
    h('p', {}, h('strong', {}, 'Formats: '), period.formats.join(', ')),
    h('p', {}, h('strong', {}, 'Targets')),
    h('ul', { class: 'plan-list' }, period.targets.map((target) => h('li', {}, target)))))));
}

function renderScoreboard(report, handles) {
  const cell = (row, series) => {
    const isLeader = row.leader === series;
    return h('td', { class: `num${isLeader ? ' lead-mark' : ''}` },
      FORMATTERS[row.format](row[series]),
      isLeader && h('span', { class: 'lead-tag' }, 'Ahead'));
  };
  const rows = report.scoreboard.map((row) => h('tr', {},
    h('td', {}, row.label, row.note && h('span', { class: 'row-note' }, row.note)),
    cell(row, 'a'),
    cell(row, 'b')));
  return section(`Head to head with @${handles[1]}`, 'Differences under 5% are treated as a tie.', h('div', { class: 'card table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Measure'), h('th', { class: 'num' }, `@${handles[0]}`), h('th', { class: 'num' }, `@${handles[1]}`))),
      h('tbody', {}, rows))));
}

function legend(handles) {
  return h('div', { class: 'legend' },
    h('span', {}, h('span', { class: 'swatch a' }), `@${handles[0]}`),
    handles[1] && h('span', {}, h('span', { class: 'swatch b' }), `@${handles[1]}`));
}

function renderScatter(report, handles) {
  const [a, b] = report.accounts;
  const reels = (account) => account.posts.filter((post) => post.views != null);
  if (!reels(a).length && !(b && reels(b).length)) return null;
  const describe = (post) => ({
    title: post.hook || 'No caption',
    lines: [
      `@${handles[post.series === 'a' ? 0 : 1]}, ${shortDate(post.timestamp)}`,
      `${count(post.views)} views, ${count(post.likes)} likes, ${count(post.comments)} comments`,
      ...(post.perf != null ? [`${multiple(post.perf)} this account's typical post`] : []),
    ],
  });
  const tableRows = [[a, handles[0]], b && [b, handles[1]]].filter(Boolean).flatMap(([account, handle]) => reels(account).map((post) => h('tr', {},
    h('td', {}, `@${handle}`),
    h('td', {}, postLink(post, report.mode === 'demo', post.hook || 'No caption')),
    h('td', {}, shortDate(post.timestamp)),
    h('td', { class: 'num' }, count(post.views)),
    h('td', { class: 'num' }, count(post.likes)),
    h('td', { class: 'num' }, count(post.comments)))));

  return section('Reel views over time', 'Each mark is one Reel. The scale is logarithmic, so each gridline step is a multiple rather than a fixed amount.',
    h('div', { class: 'card' }, legend(handles), viewsScatter(reels(a), b ? reels(b) : [], describe),
      h('details', { class: 'table-view' }, h('summary', {}, 'Show as a table'), h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, ['Account', 'Post', 'Date'].map((t) => h('th', {}, t)), ['Views', 'Likes', 'Comments'].map((t) => h('th', { class: 'num' }, t)))),
          h('tbody', {}, tableRows))))));
}

function renderBreakdowns(report, handles) {
  const [a, b] = report.accounts.map((account) => account.metrics.breakdowns);
  const names = { nameA: `@${handles[0]}`, nameB: handles[1] ? `@${handles[1]}` : '' };
  const index = { format: multiple, referenceAt: 1, referenceLabel: 'Typical = 1×', ...names };
  const block = (title, key, options = index) => h('div', { class: 'card' }, h('h3', {}, title), pairedBars(a[key], b ? b[key] : null, options));
  return section('What drives performance',
    `Bars show how posts did against each account's own typical post, so accounts of different sizes can be compared. Faded bars rest on fewer than 3 posts. Times use ${report.timezone}. These are patterns, not proof of cause.`,
    legend(handles),
    h('div', { class: 'grid-2' },
      block('Reel length', 'duration'),
      block('Time of day', 'timeOfDay'),
      block('Day of week', 'weekday'),
      block('Caption length', 'captionLength'),
      block('Question in the opening line', 'question'),
      block('Call to action in the caption', 'callToAction'),
      block('Engagement rate by format', 'formatEngagement', { format: percent, ...names })));
}

function postCard(post, isDemo) {
  const up = post.perf >= 1;
  const hint = post.audienceHint;
  const clues = [
    hint?.location && `Tagged: ${hint.location}`,
    hint?.topCommentScript && `${Math.round(hint.topCommentScript.share * 100)}% of sampled comments with words are in ${hint.topCommentScript.label}`,
  ].filter(Boolean);
  const thumb = post.thumb
    ? h('img', { class: 'thumb', src: post.thumb, alt: 'Post cover', loading: 'lazy' })
    : h('div', { class: 'thumb thumb-empty' }, isDemo ? 'Sample post' : 'No image');
  return h('article', { class: 'post' }, thumb, h('div', {},
    h('p', {}, h('span', { class: `perf ${up ? 'up' : 'down'}` }, `${multiple(post.perf)} typical`), ` by ${post.perfBasis}, ${post.type}`),
    h('p', {}, postLink(post, isDemo, post.hook || 'No caption')),
    h('p', { class: 'post-stats' }, [
      post.views != null && `${count(post.views)} views`,
      `${count(post.likes)} likes`,
      `${count(post.comments)} comments`,
      post.duration != null && `${Math.round(post.duration)}s`,
      shortDate(post.timestamp),
    ].filter(Boolean).join(' · ')),
    clues.length > 0 && h('p', { class: 'post-hint' }, `Audience clues: ${clues.join('. ')}.`)));
}

function renderOutliers(report, handles) {
  const isDemo = report.mode === 'demo';
  return section('Best and worst posts', "Ranked against each account's own typical post.",
    h('div', { class: 'grid-2' }, report.accounts.slice(0, 2).map((account, i) => {
      const byCode = new Map(account.posts.map((post) => [post.shortCode, post]));
      const list = (codes) => h('div', { class: 'posts' }, codes.map((code) => postCard(byCode.get(code), isDemo)));
      return h('div', { class: 'stack' },
        who(handles[i], i ? 'b' : 'a'),
        h('h3', {}, 'Best'), list(account.metrics.winners),
        h('h3', {}, 'Worst'), list(account.metrics.losers));
    })));
}

function renderRefs(report, refs) {
  if (!refs?.length) return null;
  const posts = new Map(report.accounts.flatMap((account) => account.posts.map((post) => [post.shortCode, post])));
  const links = refs.flatMap((ref, i) => {
    const post = posts.get(ref);
    const label = post?.hook ? `"${post.hook.slice(0, 40)}${post.hook.length > 40 ? '…' : ''}"` : ref;
    return [i ? ', ' : '', postLink(post, report.mode === 'demo', label)];
  });
  return h('span', {}, 'See: ', links);
}

function findingNode(report, finding) {
  const label = finding.kind === 'observed' ? 'Seen in the data' : 'Likely explanation';
  return h('div', { class: 'finding' },
    h('p', { class: 'claim' }, finding.claim),
    h('p', { class: 'evidence' }, finding.evidence),
    h('div', { class: 'tags' },
      h('span', { class: 'tag' }, label),
      h('span', { class: 'tag' }, `${finding.confidence} confidence`),
      renderRefs(report, finding.post_refs)));
}

const findings = (report, items) => h('div', { class: 'findings' }, items.map((item) => findingNode(report, item)));

function renderAnalysisAccounts(report, handles) {
  const { accounts } = report.analysis;
  const pair = (render) => h('div', { class: 'grid-2' }, accounts.slice(0, 2).map((account, i) => h('div', { class: 'card' },
    h('p', {}, who(handles[i], i ? 'b' : 'a')), render(account))));

  return [
    section('Why the winning content works', 'Comparing each account with itself separates the content from audience size.',
      pair((account) => findings(report, account.working))),
    section('What is not working', null, pair((account) => findings(report, account.not_working))),
    section(isCreator(report) ? 'Is it building a loyal audience?' : 'Is it reaching buyers?', null, pair((account) => h('div', {},
      h('p', { class: 'claim' }, account.business_fit.assessment),
      h('p', { class: 'evidence' }, account.business_fit.evidence)))),
  ];
}

function cluesList(audience, aiRead) {
  const items = [];
  if (audience.accountCountry) items.push(`Instagram lists the account as based in ${audience.accountCountry}.`);
  for (const script of audience.commentScripts.slice(0, 4)) {
    items.push(`${Math.round(script.share * 100)}% of sampled comments with words are in ${script.label}. ${script.hint}.`);
  }
  if (audience.locationTags.length) {
    items.push(`Location tags: ${audience.locationTags.slice(0, 4).map((tag) => `${tag.label} (${tag.count})`).join(', ')}.`);
  }
  if (audience.placeHashtags.length) {
    items.push(`Place hashtags: ${audience.placeHashtags.slice(0, 4).map((tag) => `${tag.label} (${tag.count})`).join(', ')}.`);
  }
  const { intent } = audience;
  items.push(`Of ${intent.sampled} sampled comments: ${intent.buyingIntent} about buying, ${intent.questions} questions, ${intent.emojiOnly} emoji only.`);
  if (intent.keywordReplies) items.push(`${intent.keywordReplies} sampled comments repeat one word (${intent.replyKeywords.join(', ')}), probably replies to a comment prompt. These show the prompt working and are not counted as buying intent.`);
  return h('div', {},
    aiRead && h('p', {}, h('strong', {}, `${aiRead.summary} `), `(${aiRead.confidence} confidence)`),
    h('ul', { class: 'clues' }, items.map((item) => h('li', {}, item))));
}

function renderAudience(report, handles) {
  return section('Audience and location clues',
    'Instagram does not publish views or likes by country. These clues show a likely direction only, and comment language is not the same as location.',
    h('div', { class: 'grid-2' }, report.accounts.slice(0, 2).map((account, i) => h('div', { class: 'card' },
      h('p', {}, who(handles[i], i ? 'b' : 'a')),
      cluesList(account.audience, report.analysis?.accounts?.[i]?.audience_read)))));
}

function spikeNode(report, spike, posts) {
  const byCode = new Map(posts.map((post) => [post.shortCode, post]));
  const labels = { likely: 'Likely linked', possible: 'Possibly linked', unexplained: 'No post in this window' };
  return h('div', { class: 'spike' },
    h('strong', {}, `+${count(spike.gain)} followers by ${shortDate(spike.to)}`),
    ' ', h('span', { class: 'tag' }, labels[spike.confidence]),
    spike.candidates.length > 0 && h('div', {}, 'Posted around then: ', spike.candidates.flatMap((code, i) => {
      const post = byCode.get(code);
      const hook = post?.hook ?? '';
      return [i ? ', ' : '', postLink(post, report.mode === 'demo', hook.length > 60 ? `${hook.slice(0, 60)}…` : hook || code)];
    })));
}

function renderGrowth(report, handles) {
  const tracked = report.accounts.slice(0, 2);
  const ready = tracked.some((account) => account.growth.status === 'ready');
  const hasLines = tracked.some((account) => account.growth.days >= 2);
  const statusLine = (account, handle) => (account.growth.status === 'ready'
    ? `@${handle}: ${account.growth.netGain >= 0 ? '+' : ''}${count(account.growth.netGain)} followers over ${account.growth.days} days, typically ${count(account.growth.typicalPerDay)} a day.`
    : `@${handle}: ${account.growth.days} of ${account.growth.requiredDays} days collected.`);
  return section('Follower growth',
    'Instagram does not show followers gained per post, so the tool saves each follower count daily and matches unusual jumps to post dates. This shows timing, and a jump could also come from ads or a collaboration.',
    h('div', { class: 'card' },
      h('div', { class: 'growth-status' }, tracked.flatMap((account, i) => [i ? h('br') : null, statusLine(account, handles[i])])),
      !ready && h('p', { class: 'note' }, 'Tracking started with this audit and cannot look back. Keep the app open or run the daily snapshot to fill this in.'),
      hasLines && h('div', {}, legend(handles), growthChart(tracked[0].growth.series, tracked[1]?.growth.series ?? [], `@${handles[0]}`, handles[1] ? `@${handles[1]}` : ''))),
    ready && h('div', { class: 'grid-2' }, tracked.map((account, i) => h('div', { class: 'card' },
      h('p', {}, who(handles[i], i ? 'b' : 'a')),
      account.growth.spikes.length
        ? account.growth.spikes.map((spike) => spikeNode(report, spike, account.posts))
        : h('p', { class: 'note' }, 'No unusual jumps yet.')))));
}

function renderPlan(report, handles) {
  const analysis = report.analysis;
  const [aName, bName] = handles.map((handle) => `@${handle}`);
  return {
    adapt: Boolean(bName) && (analysis.a_should_copy_from_b ?? []).length > 0 && section(`What to adapt from ${bName}`, null, h('div', { class: 'card findings' }, analysis.a_should_copy_from_b.map((item) => h('div', { class: 'finding' },
      h('p', { class: 'claim' }, item.move), h('p', { class: 'evidence' }, item.why),
      h('div', { class: 'tags' }, renderRefs(report, item.post_refs)))))),
    gaps: (analysis.gaps_neither_fills ?? []).length > 0 && section('Content gaps nobody owns', null, h('div', { class: 'card findings' }, analysis.gaps_neither_fills.map((item) => h('div', { class: 'finding' },
      h('p', { class: 'claim' }, item.gap), h('p', { class: 'evidence' }, item.why_it_matters))))),
    ideas: (analysis.post_ideas_for_a ?? []).length > 0 && section(`Post ideas for ${aName}`, null, h('div', { class: 'grid-2' }, analysis.post_ideas_for_a.map((idea) => h('div', { class: 'card' },
      h('h3', {}, idea.title), h('p', {}, `Hook: ${idea.hook}`), h('p', { class: 'evidence' }, idea.why),
      h('div', { class: 'tags' }, h('span', { class: 'tag' }, idea.format), renderRefs(report, idea.based_on_refs)))))),
  };
}

function renderNotes(report) {
  const line = (account) => `@${account.profile.handle}: ${account.metrics.sample.posts} posts from ${account.metrics.sample.from ? shortDate(account.metrics.sample.from) : 'unknown'} to ${account.metrics.sample.to ? shortDate(account.metrics.sample.to) : 'unknown'}${account.metrics.sample.hiddenLikes ? `, ${account.metrics.sample.hiddenLikes} with hidden likes` : ''}.`;
  const costs = [];
  if (report.scrapeCostEstimateUsd != null) costs.push(`Estimated scraping cost: $${report.scrapeCostEstimateUsd.toFixed(2)}.`);
  if (report.analysisStatus?.usage) costs.push(`Estimated AI cost: $${report.analysisStatus.usage.estimatedUsd.toFixed(2)}.`);
  return section('Data notes', null, h('div', { class: 'card' },
    report.accounts.map((account) => h('p', {}, line(account))),
    h('p', { class: 'note' }, 'Pinned posts are excluded from typical figures, and posts under 2 days old are not ranked. Engagement rate uses today\'s follower count for all posts. Scoring bands are Viralyst starting assumptions, not published benchmarks.'),
    costs.length > 0 && h('p', { class: 'note' }, costs.join(' ')),
    report.warnings?.length > 0 && h('ul', { class: 'warnings' }, report.warnings.map((warning) => h('li', {}, warning)))));
}

const isCreator = (report) => report.audienceType === 'creator';
const scoreTone = (value) => (value >= 75 ? 'good' : value >= 50 ? 'mid' : 'bad');

function renderSinceLast(report) {
  const progress = report.progress;
  if (!progress) return null;
  const change = progress.score.change;
  const changeText = change == null ? 'Not enough data to compare the scores.' : change === 0 ? 'No change in the score' : `${change > 0 ? '+' : ''}${change} points`;
  const STATUS = { improved: ['Improved', 'good'], worse: ['Got worse', 'bad'], unchanged: ['No change yet', 'flat'], unknown: ["Can't tell yet", 'flat'] };
  const fmt = (metric, value) => (value == null ? '–' : (FORMATTERS[metric.format] ?? count)(value));
  return section('Since your last audit', `Compared with the audit from ${shortDate(progress.previousDate)}, ${progress.daysBetween < 1 ? 'earlier the same day' : `${progress.daysBetween} day${progress.daysBetween === 1 ? '' : 's'} earlier`}.`,
    h('div', { class: 'grid-2' },
      h('div', { class: 'card since-score' },
        h('p', { class: 'since-numbers' }, h('span', {}, progress.score.before ?? '–'), h('span', { class: 'since-arrow', 'aria-hidden': 'true' }, '→'), h('strong', {}, progress.score.after ?? '–')),
        h('p', { class: `since-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}` }, changeText),
        h('p', { class: 'note' }, progress.fixesTracked ? `${progress.fixesImproved} of the ${progress.fixesTracked} earlier fixes we can measure have improved.` : 'None of the earlier fixes can be measured yet.'),
        h('a', { class: 'no-print', href: `#report/${progress.previousId}` }, 'Open the earlier audit')),
      h('div', { class: 'card table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Measure'), h('th', { class: 'num' }, 'Before'), h('th', { class: 'num' }, 'Now'))),
        h('tbody', {}, progress.metrics.map((metric) => h('tr', {}, h('td', {}, metric.label), h('td', { class: 'num' }, fmt(metric, metric.before)), h('td', { class: 'num' }, fmt(metric, metric.after)))))))),
    progress.fixes.length > 0 && h('div', { class: 'card spaced' }, h('h3', {}, 'Did the earlier fixes work?'),
      h('ul', { class: 'fix-status' }, progress.fixes.map((fix) => {
        const [label, tone] = STATUS[fix.status] ?? STATUS.unknown;
        return h('li', {}, h('span', { class: `status-tag ${tone}` }, label), h('span', {}, fix.fix),
          fix.before != null && fix.after != null && h('span', { class: 'note' }, `Checkpoint score ${fix.before} → ${fix.after}`));
      }))));
}

function hookFacts(stats) {
  const hook = stats.hook ?? {};
  const at = (value) => (value == null ? '–' : `${value}s`);
  const fact = (value, label) => h('li', {}, h('strong', {}, value), h('span', {}, label));
  return h('ul', { class: 'hook-facts' },
    fact(stats.hasAudio === false ? 'None' : at(hook.soundStart), 'sound starts'),
    fact(at(hook.firstMovement), 'first movement'),
    fact(at(hook.firstCut), 'first cut'),
    fact(stats.cutsPer10Seconds == null ? '–' : String(stats.cutsPer10Seconds), 'cuts per 10 seconds'),
    fact(`${Math.round(stats.seconds ?? 0)}s`, 'long'));
}

function chartKey() {
  return h('p', { class: 'chart-key note' },
    h('span', {}, h('span', { class: 'key energy' }), 'Energy: movement, sound and cuts'),
    h('span', {}, h('span', { class: 'key weak' }), 'Weakest stretch'),
    h('span', {}, h('span', { class: 'key silence' }), 'Silence'),
    h('span', {}, h('span', { class: 'key cut' }), 'Cut'));
}

function feedbackParts(feedback) {
  return h('div', { class: 'reel-parts' }, feedback.parts.map((part) => {
    const fill = h('span');
    fill.style.width = `${part.score}%`;
    return h('div', { class: 'reel-part' },
      h('div', { class: 'reel-part-head' }, h('span', {}, part.label), h('strong', {}, String(part.score))),
      h('span', { class: `meter ${scoreTone(part.score)}`, 'aria-hidden': 'true' }, fill),
      h('p', { class: 'note' }, [].concat(part.notes ?? []).join(' ')));
  }));
}

function reelCard(report, post, handle, series) {
  const video = post.video;
  const feedback = video.feedback;
  const isDemo = report.mode === 'demo';
  return h('article', { class: 'card reel-card' },
    h('div', { class: 'reel-card-head' },
      post.thumb ? h('img', { class: 'thumb', src: post.thumb, alt: 'Reel cover', loading: 'lazy' }) : h('div', { class: 'thumb thumb-empty' }, isDemo ? 'Sample' : 'No image'),
      h('div', { class: 'reel-card-title' },
        who(handle, series),
        h('p', {}, h('strong', {}, postLink(post, isDemo, post.hook || 'No caption'))),
        h('p', { class: 'post-stats' }, [post.views != null && `${count(post.views)} views`, post.perf != null && `${multiple(post.perf)} typical`, shortDate(post.timestamp)].filter(Boolean).join(' · '))),
      feedback && h('div', { class: `reel-score ${scoreTone(feedback.overall)}` }, h('strong', {}, String(feedback.overall)), h('span', {}, 'Reel score'))),
    hookFacts(video),
    timelineChart(video, post.hook || 'Reel'),
    chartKey(),
    feedback && feedbackParts(feedback),
    feedback?.fixes?.length > 0 && h('div', {}, h('h3', {}, 'Fix first'), h('ol', { class: 'plan-list' }, feedback.fixes.slice(0, 3).map((item) => h('li', {}, item.fix)))));
}

function renderReelBreakdown(report) {
  const handles = report.accounts.map((account) => account.profile.handle);
  const measured = (account) => account.posts.filter((post) => post.video?.timeline?.length).sort((x, y) => (y.perf ?? 0) - (x.perf ?? 0));
  const own = measured(report.accounts[0]);
  const others = report.accounts.slice(1).flatMap((account, i) => measured(account).map((post) => [post, handles[i + 1]]));
  if (!own.length && !others.length) return [emptyState('No Reels were measured second by second in this audit. Audits made before this feature do not have it, so run a new audit to see it.')];
  return [
    own.length > 0 && section(`@${handles[0]}'s Reels, second by second`, 'Energy combines on-screen movement, sound level and cuts. Dips are where viewers are most likely to swipe away. Retention itself is private, so confirm the biggest dips in Insights.',
      h('div', { class: 'reel-list' }, own.map((post) => reelCard(report, post, handles[0], 'a')))),
    others.length > 0 && section(isCreator(report) ? 'How similar creators run their Reels' : 'How competitors run their Reels', 'The same measurements for the other accounts, so you can see how their openings differ.',
      h('div', { class: 'reel-list' }, others.map(([post, handle]) => reelCard(report, post, handle, 'b')))),
  ];
}

function renderBestTimes(report) {
  const account = report.accounts[0];
  const times = account.metrics.bestTimes;
  if (!times?.sample) return null;
  const slotName = (slot) => slot.split(' (')[0].toLowerCase();
  const shade = (cell) => (!cell.n || cell.value == null ? 'none' : cell.n < 2 ? 'thin' : cell.value >= 1.5 ? 'l4' : cell.value >= 1.1 ? 'l3' : cell.value >= 0.8 ? 'l2' : 'l1');
  const best = times.best.map((cell) => `${cell.day} ${slotName(cell.slot)} (${multiple(cell.value)} typical, ${cell.n} posts)`);
  return section('Best time to post', `From @${account.profile.handle}'s own public posts, in ${report.timezone}. Each cell shows how posts at that time did against the typical post. Faded cells rest on one post.`,
    h('div', { class: 'card' },
      best.length ? h('p', {}, h('strong', {}, 'Best slots so far: '), `${best.join(', ')}.`) : h('p', { class: 'note' }, 'Not enough posts at the same times yet. Post at a few fixed times for a month to find your best slots.'),
      times.busiest && h('p', { class: 'note' }, `You post most often on ${times.busiest.day} ${slotName(times.busiest.slot)} (${times.busiest.n} posts).`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'heatmap' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Day'), times.slots.map((slot) => h('th', {}, slot)))),
        h('tbody', {}, times.grid.map((row, i) => h('tr', {}, h('th', {}, times.days[i]), row.map((cell) => h('td', {
          class: `heat ${shade(cell)}`,
          title: cell.n ? `${cell.n} post${cell.n === 1 ? '' : 's'}` : 'No posts',
        }, cell.n && cell.value != null ? multiple(cell.value) : '')))))))));
}

function renderLanguageAndFestivals(report) {
  const account = report.accounts[0];
  const languages = account.metrics.breakdowns?.captionLanguage ?? [];
  const fest = account.metrics.festivals;
  const blocks = [];
  if (languages.filter((row) => row.n).length > 1) {
    blocks.push(h('div', { class: 'card' }, h('h3', {}, 'Caption language'),
      h('p', { class: 'note' }, 'How posts in each caption language did against the typical post.'),
      pairedBars(languages, null, { format: multiple, referenceAt: 1, referenceLabel: 'Typical = 1×', nameA: `@${account.profile.handle}` })));
  }
  if (fest?.festivalPosts) {
    const line = (label, n, value) => (!n || value == null ? null : h('li', {}, h('strong', {}, `${label}: `), `${multiple(value)} typical, ${n} post${n === 1 ? '' : 's'}`));
    const occasions = fest.byFestival.filter((item) => item.value != null);
    blocks.push(h('div', { class: 'card' }, h('h3', {}, 'Festivals and occasions'),
      h('ul', { class: 'plan-list' },
        line('Festival posts', fest.festivalPosts, fest.festivalValue),
        fest.otherValue != null && h('li', {}, h('strong', {}, 'Everything else: '), `${multiple(fest.otherValue)} typical`),
        line('Festival posts with an offer', fest.offer.n, fest.offer.value),
        line('Greetings only', fest.greeting.n, fest.greeting.value)),
      occasions.length > 0 && h('p', { class: 'note' }, `By occasion: ${occasions.map((item) => `${item.festival} ${multiple(item.value)} (${item.n})`).join(', ')}.`)));
  }
  if (!blocks.length) return null;
  return section(isCreator(report) ? 'Language and occasions' : 'Language, festivals and offers', "Patterns from this account's own posts. With few posts, treat them as a hint.", h('div', { class: 'grid-2' }, blocks));
}

function fillCompetitors(handles) {
  const inputs = [...document.querySelectorAll('.competitor')];
  inputs.forEach((input) => { input.value = ''; });
  handles.forEach((handle, i) => { if (inputs[i]) inputs[i].value = handle; });
}

function startAuditWith(report, handles) {
  setMode(isCreator(report) ? 'creator' : 'business');
  $('input-a').value = report.accounts[0].profile.handle;
  fillCompetitors(handles);
  wizardStep = 2;
  window.location.hash = '#/new';
}

function renderSuggestions(report) {
  const known = new Set(report.accounts.map((account) => account.profile.handle.toLowerCase()));
  const fresh = (report.accounts[0].profile.relatedProfiles ?? []).filter((item) => !known.has(item.handle.toLowerCase()));
  if (!fresh.length) return null;
  const isDemo = report.mode === 'demo';
  return section(isCreator(report) ? 'Creators Instagram links to you' : 'Accounts Instagram links to you', 'Instagram lists these as similar to this account. They are strong candidates to compare against next time.',
    h('div', { class: 'card' },
      h('div', { class: 'suggestion-chips' }, fresh.map((item) => (isDemo
        ? h('span', { class: 'chip' }, `@${item.handle}`)
        : h('a', { class: 'chip', href: `https://www.instagram.com/${encodeURIComponent(item.handle)}/`, target: '_blank', rel: 'noopener noreferrer' }, `@${item.handle}`, item.verified ? ' ✓' : '')))),
      !STATIC_SITE && h('button', { class: 'button small no-print spaced', type: 'button', onclick: () => startAuditWith(report, fresh.slice(0, 3).map((item) => item.handle)) }, 'Audit again with the top 3')));
}

// ---------- AI tools on a report ----------

const chatHistory = new Map();
const aiReady = () => status.anthropic && !STATIC_SITE;

function aiNote(what) {
  return h('div', { class: 'card notice-card' },
    h('p', {}, STATIC_SITE ? `${what} works in the full Viralyst app.` : `${what} needs a working Anthropic key. Add one in Settings, then come back.`),
    !STATIC_SITE && h('a', { class: 'button small', href: '#/settings' }, 'Go to Settings'));
}

function postTool(report, tool, body) {
  return api(`/api/reports/${report.id}/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function rememberCreation(report, entry) {
  report.creations = [...(report.creations ?? []), entry];
}

function errorLine() {
  return h('p', { class: 'error', role: 'alert', hidden: true });
}

function showProblem(node, problem) {
  node.textContent = problem.message;
  node.hidden = false;
}

function copyButton(getText, label = 'Copy') {
  const button = h('button', { class: 'button ghost small no-print', type: 'button' }, label);
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = label; }, 1500);
  });
  return button;
}

function renderChat(report) {
  const history = chatHistory.get(report.id) ?? [];
  chatHistory.set(report.id, history);
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const error = errorLine();
  const input = h('textarea', { rows: '2', maxlength: '2000', 'aria-label': 'Your question', placeholder: isCreator(report) ? 'Why did my last Reel flop?' : 'Which posts bring the most buyers?' });
  const send = h('button', { class: 'button primary', type: 'submit' }, 'Ask');
  const draw = () => log.replaceChildren(...(history.length
    ? history.map((message) => h('div', { class: `chat-msg ${message.role}` }, h('span', { class: 'chat-who' }, message.role === 'user' ? 'You' : 'Viralyst'), h('p', {}, message.content)))
    : [h('p', { class: 'note' }, "Ask anything about this report. Answers use only this audit's data.")]));
  const ask = async (text) => {
    const question = text.trim();
    if (!question || send.disabled) return;
    error.hidden = true;
    history.push({ role: 'user', content: question });
    input.value = '';
    draw();
    send.disabled = true;
    send.textContent = 'Thinking…';
    try {
      const { reply } = await postTool(report, 'chat', { messages: history });
      history.push({ role: 'assistant', content: reply });
    } catch (problem) {
      history.pop();
      input.value = question;
      showProblem(error, problem);
    } finally {
      send.disabled = false;
      send.textContent = 'Ask';
      draw();
    }
  };
  const form = h('form', { class: 'chat-form' }, input, send);
  form.addEventListener('submit', (event) => { event.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask(input.value);
    }
  });
  const starters = isCreator(report)
    ? ['Why did my best Reel work?', 'What should I post this week?', 'How do I get more brand deals?']
    : ['Why is my competitor ahead?', 'What should I post this week?', 'How do I turn comments into sales?'];
  draw();
  return section('Ask Viralyst', 'A coach that has read this whole audit. It answers from the data and says when something is a guess.',
    h('div', { class: 'card chat' }, log,
      h('div', { class: 'starter-row' }, starters.map((question) => h('button', { class: 'chip-button', type: 'button', onclick: () => ask(question) }, question))),
      form, error));
}

const scriptText = (script) => [
  script.title,
  `Opening line: ${script.hook_line}`,
  `On-screen text: ${script.on_screen_text}`,
  ...script.beats.map((beat) => `${beat.at_seconds}s: ${beat.visual}${beat.line ? ` "${beat.line}"` : ''}`),
  `Caption: ${script.caption}`,
  `Call to action: ${script.call_to_action}`,
  script.hashtags.join(' '),
].join('\n');

function scriptNode(script) {
  return h('div', { class: 'script' },
    h('h4', {}, script.title),
    h('p', {}, h('strong', {}, 'Opening line: '), script.hook_line),
    h('p', {}, h('strong', {}, 'On-screen text: '), script.on_screen_text),
    h('ol', { class: 'beats' }, script.beats.map((beat) => h('li', {}, h('span', { class: 'beat-time' }, `${beat.at_seconds}s`), h('span', {}, h('strong', {}, beat.visual), beat.line ? ` "${beat.line}"` : '')))),
    h('p', {}, h('strong', {}, 'Caption: '), script.caption),
    h('p', {}, h('strong', {}, 'Call to action: '), script.call_to_action),
    h('p', { class: 'note' }, script.hashtags.join(' ')),
    script.filming_notes && h('p', { class: 'note' }, `Filming notes: ${script.filming_notes}`),
    copyButton(() => scriptText(script), 'Copy script'));
}

function ideaCard(report, idea) {
  const holder = h('div');
  const error = errorLine();
  const button = h('button', { class: 'button small no-print', type: 'button', disabled: aiReady() ? null : 'disabled' }, 'Write the script');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Writing…';
    error.hidden = true;
    try {
      const { script } = await postTool(report, 'script', { idea });
      holder.replaceChildren(scriptNode(script));
      button.hidden = true;
      rememberCreation(report, { type: 'script', createdAt: new Date().toISOString(), script });
    } catch (problem) {
      showProblem(error, problem);
      button.disabled = false;
      button.textContent = 'Write the script';
    }
  });
  return h('div', { class: 'card idea' },
    h('h3', {}, idea.title),
    h('p', {}, `Hook: ${idea.hook}`),
    h('p', { class: 'evidence' }, idea.why),
    h('div', { class: 'tags' }, h('span', { class: 'tag' }, idea.format), idea.length_seconds ? h('span', { class: 'tag' }, `${idea.length_seconds}s`) : null, renderRefs(report, idea.based_on_refs)),
    button, error, holder);
}

function renderIdeas(report) {
  const topic = h('input', { maxlength: '300', 'aria-label': 'Topic', placeholder: isCreator(report) ? 'Optional topic, such as "budget travel"' : 'Optional topic, such as "Diwali gift boxes"' });
  const button = h('button', { class: 'button primary', type: 'submit' }, 'Get post ideas');
  const results = h('div', { class: 'grid-2 spaced' });
  const error = errorLine();
  const form = h('form', { class: 'idea-form' }, topic, button);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = 'Thinking…';
    error.hidden = true;
    try {
      const { ideas } = await postTool(report, 'ideas', { topic: topic.value, count: 6 });
      results.replaceChildren(...ideas.map((idea) => ideaCard(report, idea)));
      rememberCreation(report, { type: 'ideas', createdAt: new Date().toISOString(), topic: topic.value, ideas });
    } catch (problem) {
      showProblem(error, problem);
    } finally {
      button.disabled = false;
      button.textContent = 'Get post ideas';
    }
  });
  return section('Post ideas and scripts', 'Ideas built on what already worked for this account. Turn any idea into a shot-by-shot script.', h('div', { class: 'card' }, form, error), results);
}

function pitchNode(pitch) {
  return h('div', { class: 'pitch' },
    h('p', {}, h('strong', {}, 'Subject: '), pitch.subject),
    h('pre', { class: 'bio' }, pitch.message),
    copyButton(() => `Subject: ${pitch.subject}\n\n${pitch.message}`, 'Copy pitch'),
    h('h4', {}, 'Follow-up'),
    h('pre', { class: 'bio' }, pitch.follow_up),
    copyButton(() => pitch.follow_up, 'Copy follow-up'),
    pitch.numbers_used?.length > 0 && h('p', { class: 'note' }, `Numbers used: ${pitch.numbers_used.join(', ')}. Check them before sending.`));
}

const CREATION_LABELS = { ideas: 'Post ideas', script: 'Script', pitch: 'Brand pitch' };

function renderSaved(report) {
  const items = [...(report.creations ?? [])].reverse().slice(0, 12);
  if (!items.length) return null;
  return section('Saved for this report', 'Everything generated for this report is kept here.', h('div', { class: 'stack' }, items.map((item) => {
    const detail = item.topic || item.brand || item.script?.title || '';
    return h('details', { class: 'card saved' },
      h('summary', {}, `${CREATION_LABELS[item.type] ?? 'Saved'}${detail ? `: ${detail}` : ''} · ${shortDate(item.createdAt)}`),
      item.type === 'ideas' && h('div', { class: 'grid-2' }, item.ideas.map((idea) => ideaCard(report, idea))),
      item.type === 'script' && scriptNode(item.script),
      item.type === 'pitch' && pitchNode(item.pitch));
  })));
}

function renderCreate(report) {
  if (!aiReady()) return [aiNote('Ask Viralyst, post ideas and scripts'), renderSaved(report)];
  return [renderChat(report), renderIdeas(report), renderSaved(report)];
}

function renderPitchWriter(report) {
  const brand = h('input', { maxlength: '120', placeholder: 'Acme Coffee' });
  const product = h('input', { maxlength: '300', placeholder: 'Their new cold brew' });
  const deliverables = h('input', { maxlength: '300', placeholder: '1 Reel and 3 Stories' });
  const button = h('button', { class: 'button primary', type: 'submit' }, 'Write the pitch');
  const result = h('div', { class: 'spaced' });
  const error = errorLine();
  const form = h('form', { class: 'pitch-form' },
    h('label', { class: 'field' }, h('span', {}, 'Brand'), brand),
    h('label', { class: 'field' }, h('span', {}, 'Product or campaign ', h('em', {}, '(optional)')), product),
    h('label', { class: 'field' }, h('span', {}, 'What you offer ', h('em', {}, '(optional)')), deliverables),
    button, error);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!brand.value.trim()) {
      showProblem(error, new Error('Please enter the brand name.'));
      return;
    }
    button.disabled = true;
    button.textContent = 'Writing…';
    try {
      const { pitch } = await postTool(report, 'pitch', { brand: brand.value, product: product.value, deliverables: deliverables.value });
      result.replaceChildren(pitchNode(pitch));
      rememberCreation(report, { type: 'pitch', createdAt: new Date().toISOString(), brand: brand.value, pitch });
    } catch (problem) {
      showProblem(error, problem);
    } finally {
      button.disabled = false;
      button.textContent = 'Write the pitch';
    }
  });
  return section('Brand pitch writer', 'A short pitch that uses only your real public numbers, plus a polite follow-up.', h('div', { class: 'card' }, form, result));
}

function renderDeals(report) {
  const metrics = report.accounts[0].metrics;
  const stats = [['Followers', count(metrics.followers)], ['Typical Reel views', count(metrics.medianViews)], ['Engagement rate', percent(metrics.engagementRate)], ['Posts per week', FORMATTERS.decimal(metrics.postsPerWeek)]];
  const readiness = report.score.pillars.find((pillar) => pillar.id === 11);
  return [
    section('Media kit', 'A one-page summary for brands, built from your real public numbers.', h('div', { class: 'card media-kit-card' },
      h('div', { class: 'kit-stats' }, stats.map(([label, value]) => h('div', {}, h('strong', {}, value), h('span', {}, label)))),
      STATIC_SITE
        ? h('p', { class: 'note' }, 'The printable media kit opens in the full Viralyst app.')
        : h('a', { class: 'button primary no-print', href: `/media-kit/${report.id}`, target: '_blank', rel: 'noopener' }, 'Open media kit'),
      h('p', { class: 'note' }, 'Add your rates and contact details on the media kit page, then save it as a PDF.'))),
    readiness && section('Brand-deal readiness', 'How ready the account looks to a brand that is checking it out.', h('div', { class: 'card' },
      h('p', {}, h('strong', {}, readiness.score == null ? 'Not scored yet' : `${readiness.score} out of 100`), ` from ${readiness.scoredCount} of ${readiness.totalCount} checks.`),
      h('a', { class: 'no-print', href: `#report/${report.id}/scorecard` }, 'See these checks in the Scorecard'))),
    aiReady() ? renderPitchWriter(report) : aiNote('The brand pitch writer'),
  ];
}

// ---------- Report layout ----------

function tabsFor(report) {
  const creator = isCreator(report);
  return [
    ['overview', 'Overview', 'Your score, what it means and the fixes that matter most.'],
    ['scorecard', 'Scorecard', `All ${report.score.coverage.total} checks. Enter private Insights where it says "Needs data" and the score updates straight away.`],
    ['competitors', creator ? 'Similar creators' : 'Competitors', creator ? 'How you compare with creators in your niche, on public data.' : 'How the company compares with its competitors on public data.'],
    ['content', 'Content', "Which posts work, which don't, the patterns behind them and when to post."],
    ['reels', 'Reel breakdown', 'Second by second: when sound and movement start, where energy drops, and what to fix.'],
    ['audience', 'Audience & growth', 'Who the audience probably is, and how followers are changing.'],
    ['plan', 'Action plan', 'What to do next, in order.'],
    ['create', creator ? 'Create' : 'Ask & create', 'Ask questions about this report, and get post ideas and scripts built on what has worked.'],
    creator && ['deals', 'Brand deals', 'A media kit from your real numbers, and pitches to send to brands.'],
    ['notes', 'Data notes', 'What the data covers, its limits, and what it cost.'],
  ].filter(Boolean);
}

function scoreRing(score) {
  const value = score.overall ?? 0;
  const circumference = 2 * Math.PI * 52;
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  const ring = (cls, dash) => {
    const circle = document.createElementNS(svgNs, 'circle');
    circle.setAttribute('cx', '60');
    circle.setAttribute('cy', '60');
    circle.setAttribute('r', '52');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', '10');
    circle.setAttribute('class', cls);
    if (dash) circle.setAttribute('stroke-dasharray', dash);
    return circle;
  };
  svg.append(ring('track'), ring('value', `${(value / 100) * circumference} ${circumference}`));
  return h('div', { class: 'score-ring', role: 'img', 'aria-label': score.overall == null ? 'No score yet' : `Viralyst Score ${score.overall} out of 100, ${score.rating.label}` },
    svg,
    h('div', { class: 'score-ring-label' },
      h('strong', {}, score.overall == null ? '–' : String(score.overall)),
      score.rating && h('span', { class: `rating-${score.rating.key}` }, score.rating.label)));
}

function emptyState(text) {
  return h('div', { class: 'card empty section' }, h('p', {}, text));
}

let activeTab = 'overview';
let scorecardFilter = 'all';

function renderReport(report, tab = activeTab) {
  const tabs = tabsFor(report);
  activeTab = tabs.some(([key]) => key === tab) ? tab : 'overview';
  const handles = report.accounts.map((account) => account.profile.handle);
  const hasAnalysis = Boolean(report.analysis);
  const state = report.analysisStatus?.state;
  const plan = hasAnalysis ? renderPlan(report, handles) : {};

  const banners = [];
  if (report.mode === 'demo') banners.push(h('div', { class: 'banner' }, h('strong', {}, 'Sample report. '), 'These companies, numbers and written conclusions are invented to show the format.'));
  if (state === 'off' || state === 'failed') banners.push(h('div', { class: 'banner' }, h('strong', {}, 'Written analysis unavailable. '), report.analysisStatus.reason));

  const panels = {
    overview: [
      ...banners,
      renderSinceLast(report),
      hasAnalysis && section('The short version', null, h('div', { class: 'card' }, h('p', { class: 'headline' }, report.analysis.headline), h('p', {}, report.analysis.summary))),
      renderScoreHero(report),
      renderTopFixes(report, 5),
      renderHonesty(),
    ],
    scorecard: [renderScorecard(report)],
    competitors: [
      renderBenchmark(report),
      handles.length > 1 && report.scoreboard?.length > 0 && renderScoreboard(report, handles),
      hasAnalysis && report.analysis.why_the_leader_leads?.length && section('Why one is ahead', null, h('div', { class: 'card' }, findings(report, report.analysis.why_the_leader_leads))),
      plan.adapt,
      plan.gaps,
      renderSuggestions(report),
      handles.length < 2 && emptyState(isCreator(report) ? 'This was a solo audit. Add similar creators next time to see how you compare.' : 'Add competitors next time to see the head-to-head comparison.'),
    ],
    content: [
      renderScatter(report, handles),
      renderOutliers(report, handles),
      renderTeardown(report),
      ...(hasAnalysis ? renderAnalysisAccounts(report, handles) : []),
      renderBreakdowns(report, handles),
      renderBestTimes(report),
      renderLanguageAndFestivals(report),
    ],
    reels: renderReelBreakdown(report),
    audience: [renderAudience(report, handles), renderGrowth(report, handles)],
    plan: [
      renderTopFixes(report),
      renderProfileRewrite(report),
      renderPlan306090(report),
      plan.ideas,
      !hasAnalysis && emptyState('The profile rewrite, 30-60-90 day plan and post ideas need the AI analysis. Add Anthropic credit in Settings and run the audit again without "Numbers only".'),
    ],
    create: renderCreate(report),
    deals: isCreator(report) ? renderDeals(report) : [],
    notes: [renderNotes(report)],
  };

  const tabButtons = tabs.map(([key, label]) => h('button', {
    class: 'tab',
    type: 'button',
    role: 'tab',
    id: `tab-${key}`,
    'aria-selected': String(key === activeTab),
    'aria-controls': `panel-${key}`,
    tabindex: key === activeTab ? '0' : '-1',
    onclick: () => { window.location.hash = `#report/${report.id}/${key}`; },
  }, label));

  const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Report sections' }, tabButtons);
  tabList.addEventListener('keydown', (event) => {
    const index = tabs.findIndex(([key]) => key === activeTab);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(index + step + tabs.length) % tabs.length][0];
    window.location.hash = `#report/${report.id}/${next}`;
    requestAnimationFrame(() => $(`tab-${next}`)?.focus());
  });

  const hero = h('header', { class: 'report-hero' }, h('div', { class: 'wrap' },
    h('div', { class: 'report-hero-inner' },
      h('div', {},
        h('p', { class: 'crumbs' }, h('a', { href: '#/audits' }, 'My audits'), ' / ', `@${handles[0]}`),
        h('h1', {}, `@${handles[0]} `, h('span', { class: 'chip' }, isCreator(report) ? 'Creator' : 'Business'), ' ', report.mode === 'demo' && h('span', { class: 'chip sample' }, 'Sample')),
        handles.length > 1 && h('p', { class: 'report-sub' }, `Compared with ${handles.slice(1).map((handle) => `@${handle}`).join(', ')}`),
        h('p', { class: 'report-meta' }, `Audit from ${shortDate(report.createdAt)} · Based on ${report.score.coverage.scored} of ${report.score.coverage.total} checks`),
        h('div', { class: 'report-actions' },
          h('button', { class: 'button primary small', type: 'button', onclick: () => window.print() }, 'Save as PDF'),
          h('a', { class: 'button small', href: '#/new' }, 'New audit'))),
      scoreRing(report.score)),
    tabList));

  const body = h('div', { class: 'wrap' }, tabs.map(([key, , intro]) => h('div', {
    class: 'tab-panel',
    role: 'tabpanel',
    id: `panel-${key}`,
    'aria-labelledby': `tab-${key}`,
    hidden: key !== activeTab,
  }, h('p', { class: 'tab-intro' }, intro), ...panels[key].filter(Boolean))));

  $('report').replaceChildren(hero, body);
}

// ---------- Site pages ----------

// The GitHub Pages showcase has no server, so it answers from the bundled sample report instead.
const STATIC_SITE = Boolean(document.querySelector('meta[name="viralyst-static"]'));
const CONTACT_EMAIL = 'connect.viralyst@gmail.com';
let sampleReport = null;

async function staticApi(url, options = {}) {
  sampleReport ??= await fetch('site/sample-report.json').then((response) => response.json());
  const summary = {
    id: sampleReport.id,
    createdAt: sampleReport.createdAt,
    mode: sampleReport.mode,
    handles: sampleReport.accounts.map((account) => account.profile.handle),
    overall: sampleReport.score.overall,
    audienceType: sampleReport.audienceType,
  };
  if (url === '/api/status') return { apify: false, anthropic: false, static: true };
  if (url === '/api/reports') return [summary];
  if (url === '/api/reel-checks') return [];
  if (url === '/api/audit') return { jobId: 'sample' };
  if (url === '/api/jobs/sample') return { state: 'done', reportId: sampleReport.id };
  if (url === `/api/reports/${sampleReport.id}` && !options.method) return sampleReport;
  if (url.endsWith('/inputs')) throw new Error('Entering private Insights works in the full Viralyst app.');
  throw new Error('This is available in the full Viralyst app.');
}

async function api(url, options) {
  if (STATIC_SITE) return staticApi(url, options);
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Please sign in again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

const PAGES = ['home', 'new', 'audits', 'reels', 'settings', 'report'];

function showPage(name) {
  if (name !== 'home') $('sticky-cta').hidden = true;
  for (const page of PAGES) $(`page-${page}`).hidden = page !== name;
  document.querySelectorAll('[data-nav]').forEach((link) => link.classList.toggle('active', link.dataset.nav === name));
  $('tooltip').hidden = true;
}

let status = { apify: false, anthropic: false };

async function loadStatus() {
  status = await api('/api/status').catch(() => status);
  const label = (on) => (on ? 'Connected' : 'Not connected');
  $('dot-apify').classList.toggle('on', status.apify);
  $('dot-anthropic').classList.toggle('on', status.anthropic);
  $('state-apify').textContent = label(status.apify);
  $('state-anthropic').textContent = label(status.anthropic);
  if (STATIC_SITE) {
    document.body.classList.add('static-site');
    document.querySelectorAll('[data-nav="settings"]').forEach((link) => { link.hidden = true; });
    $('setup-warning').hidden = true;
    $('home-status').textContent = '';
    $('run').textContent = 'Request my audit';
    $('reel-forms').hidden = true;
    $('reels-static-note').hidden = false;
    return;
  }
  $('settings-dot').hidden = status.apify && status.anthropic;
  $('keys-form').hidden = Boolean(status.hosted);
  $('hosted-keys-note').hidden = !status.hosted;
  $('logout').hidden = !status.loginRequired;

  const missing = [!status.apify && 'Instagram data (Apify)', !status.anthropic && 'AI analysis (Claude)'].filter(Boolean);
  $('setup-warning').hidden = status.apify;
  $('setup-warning-text').textContent = 'Real audits need an Apify token. Add it in Settings, then come back.';
  $('home-status').textContent = missing.length
    ? `Not connected yet: ${missing.join(' and ')}. The sample report works without any setup.`
    : 'Connected and ready. A full audit takes about 2 to 10 minutes.';
}

const HOME_PILLARS = {
  business: [
    ['Profile and first impression', 8], ['Audience health', 8], ['Content strategy', 10], ['Reels performance', 14],
    ['Hooks and creative quality', 10], ['Carousels, posts and Stories', 8], ['Engagement and community', 8],
    ['Discoverability and search', 8], ['Conversion and funnel', 10], ['Competitor benchmark', 6],
    ['Paid and partnerships', 4], ['Account health and brand safety', 4], ['Tracking and reporting setup', 2],
  ],
  creator: [
    ['Profile and first impression', 8], ['Audience health', 10], ['Content strategy', 12], ['Reels performance', 18],
    ['Hooks and creative quality', 16], ['Carousels, posts and Stories', 8], ['Engagement and community', 10],
    ['Discoverability and search', 8], ['Conversion and funnel', 2], ['Similar creators', 4], ['Brand-deal readiness', 4],
  ],
};

function renderPillarGrid() {
  const grid = $('pillar-grid');
  if (!grid) return;
  grid.replaceChildren(...HOME_PILLARS[audienceMode].map(([title, weight], i) => h('li', { class: 'reveal' }, h('span', {}, `${i + 1}. ${title}`), h('span', { class: 'weight' }, `${weight}%`))));
  watchReveals(grid);
}

async function renderAuditList() {
  const reports = await api('/api/reports').catch(() => []);
  if (!reports.length) {
    $('audit-list').replaceChildren(h('div', { class: 'card empty' },
      h('h2', {}, 'No audits yet'),
      h('p', {}, 'Run your first audit, or look at a sample report to see what you get.'),
      h('a', { class: 'button primary', href: '#/new' }, 'Start an audit')));
    return;
  }
  const ratingKey = (score) => (score == null ? '' : score >= 85 ? 'strong' : score >= 65 ? 'healthy' : score >= 40 ? 'needs_work' : 'critical');
  $('audit-list').replaceChildren(...reports.map((report) => h('a', { class: 'audit-card', href: `#report/${report.id}` },
    h('div', { class: `score-badge ${ratingKey(report.overall)}` }, report.overall == null ? '–' : String(report.overall)),
    h('div', {},
      h('h3', {}, `@${report.handles[0]} `, h('span', { class: 'chip' }, report.audienceType === 'creator' ? 'Creator' : 'Business'), ' ', report.mode === 'demo' && h('span', { class: 'chip sample' }, 'Sample')),
      h('p', {}, report.handles.length > 1 ? `vs ${report.handles.slice(1).map((handle) => `@${handle}`).join(', ')}` : report.audienceType === 'creator' ? 'Solo audit' : 'No competitors'),
      h('p', {}, shortDate(report.createdAt))))));
}

// ---------- New audit wizard ----------

let wizardStep = 1;
const MAX_COMPETITORS = 5;

function wizardValues() {
  return {
    a: $('input-a').value.trim(),
    competitors: [...document.querySelectorAll('.competitor')].map((node) => node.value.trim()).filter(Boolean),
    goal: document.querySelector('.goal-grid:not([hidden]) input[name="goal"]:checked')?.value ?? '',
    audienceType: audienceMode,
    idealCustomer: $('input-customer').value.trim(),
    markets: $('input-markets').value.trim(),
    notes: $('input-notes').value.trim(),
    skipAi: $('input-skip-ai').checked,
  };
}

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
}

function renderReview() {
  const values = wizardValues();
  const creator = values.audienceType === 'creator';
  const accountLabel = creator ? 'Creator' : 'Company';
  const othersLabel = creator ? 'Similar creators' : 'Competitors';
  const others = values.competitors.join(', ') || 'None, a solo audit';
  if (STATIC_SITE) {
    $('review').replaceChildren(h('dl', {},
      h('dt', {}, accountLabel), h('dd', {}, values.a),
      h('dt', {}, othersLabel), h('dd', {}, others),
      h('dt', {}, 'What happens next'), h('dd', {}, 'Your email app opens with this request ready to send to Viralyst. We run the audit and send you the report.')));
    return;
  }
  const accounts = 1 + values.competitors.length;
  const low = (accounts * 0.4).toFixed(2);
  const high = (accounts * 0.7).toFixed(2);
  $('review').replaceChildren(h('dl', {},
    h('dt', {}, accountLabel), h('dd', {}, values.a),
    h('dt', {}, othersLabel), h('dd', {}, others),
    h('dt', {}, 'Estimated cost'), h('dd', {}, `About $${low} to $${high} of Apify credit${values.skipAi || !status.anthropic ? '' : ', plus Claude usage'}`),
    h('dt', {}, 'Time'), h('dd', {}, values.skipAi ? 'About 1 to 4 minutes' : 'About 3 to 10 minutes')));
}

function setWizardStep(step) {
  wizardStep = step;
  document.querySelectorAll('.wizard-step').forEach((node) => { node.hidden = Number(node.dataset.step) !== step; });
  document.querySelectorAll('[data-step-label]').forEach((node) => {
    const n = Number(node.dataset.stepLabel);
    node.classList.toggle('active', n === step);
    node.classList.toggle('done', n < step);
  });
  $('back').hidden = step === 1;
  $('next').hidden = step === 3;
  $('run').hidden = step !== 3;
  showError('');
  if (step === 3) renderReview();
  document.querySelector(`.wizard-step[data-step="${step}"] input`)?.focus();
}

function validateStep(step) {
  const values = wizardValues();
  if (step === 1 && !values.a) return values.audienceType === 'creator' ? 'Please enter the Instagram account.' : 'Please enter the company\'s Instagram profile.';
  if (step === 2 && !values.competitors.length && values.audienceType !== 'creator') return 'Please add at least one competitor.';
  const handleOf = (value) => value.trim().toLowerCase().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').split(/[/?#]/)[0];
  if (step === 2 && new Set([values.a, ...values.competitors].map(handleOf)).size !== values.competitors.length + 1) return 'Each account should be different.';
  return null;
}

$('next').addEventListener('click', () => {
  const problem = validateStep(wizardStep);
  if (problem) return showError(problem);
  setWizardStep(wizardStep + 1);
  return null;
});
$('back').addEventListener('click', () => setWizardStep(wizardStep - 1));
$('audit-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.tagName === 'INPUT' && wizardStep < 3) {
    event.preventDefault();
    $('next').click();
  }
});
$('input-skip-ai').addEventListener('change', renderReview);

$('add-competitor').addEventListener('click', () => {
  const list = $('competitor-list');
  const n = list.querySelectorAll('.competitor').length + 1;
  if (n > MAX_COMPETITORS) return;
  const input = h('input', { class: 'competitor', autocomplete: 'off', spellcheck: 'false', placeholder: 'Optional' });
  list.append(h('label', { class: 'field' }, h('span', {}, `${audienceMode === 'creator' ? 'Similar creator' : 'Competitor'} ${n}`), input));
  input.focus();
  $('add-competitor').hidden = n >= MAX_COMPETITORS;
});

function addCompetitor(handle) {
  const same = (value) => value.trim().replace(/^@/, '').toLowerCase() === handle.toLowerCase();
  if ([...document.querySelectorAll('.competitor')].some((input) => same(input.value))) return;
  let empty = [...document.querySelectorAll('.competitor')].find((input) => !input.value.trim());
  if (!empty && !$('add-competitor').hidden) {
    $('add-competitor').click();
    empty = [...document.querySelectorAll('.competitor')].at(-1);
  }
  if (empty) empty.value = handle;
}

$('suggest-accounts').addEventListener('click', async () => {
  const box = $('suggestions');
  const button = $('suggest-accounts');
  if (STATIC_SITE) {
    box.replaceChildren(h('p', { class: 'note' }, 'Suggestions work in the full Viralyst app.'));
    return;
  }
  const handle = $('input-a').value.trim();
  if (!handle) {
    box.replaceChildren(h('p', { class: 'error' }, 'Enter the account in step 1 first.'));
    return;
  }
  button.disabled = true;
  button.textContent = 'Looking…';
  try {
    const { suggestions } = await api(`/api/suggest?handle=${encodeURIComponent(handle)}`);
    box.replaceChildren(suggestions.length
      ? h('div', { class: 'suggestion-chips' }, h('span', { class: 'note' }, 'Tap to add:'), suggestions.map((item) => h('button', {
        class: 'chip-button',
        type: 'button',
        onclick: (event) => { addCompetitor(item.handle); event.currentTarget.disabled = true; },
      }, `@${item.handle}`)))
      : h('p', { class: 'note' }, 'Instagram shows no similar accounts for this profile.'));
  } catch (problem) {
    box.replaceChildren(h('p', { class: 'error' }, problem.message));
  } finally {
    button.disabled = false;
    button.textContent = 'Suggest accounts';
  }
});

const PROGRESS_STAGES = [
  ['Checking Claude access', 'Checking AI access'],
  ['Fetching', 'Collecting 90 days of posts'],
  ['Reading comments', 'Reading comments'],
  ['Checking bio links', 'Checking bio links'],
  ['Saving covers', 'Reviewing covers and video'],
  ['Writing the audit', 'Writing the audit'],
];

function renderProgress(stepText, skipAi) {
  const stages = PROGRESS_STAGES.filter(([key]) => !(skipAi && (key === 'Checking Claude access' || key === 'Writing the audit')));
  const current = stages.findIndex(([key]) => stepText.startsWith(key));
  $('progress-steps').replaceChildren(...stages.map(([, label], i) => h('li', { class: i < current ? 'done' : i === current ? 'current' : '' }, label)));
}

async function runJob(body) {
  showError('');
  $('audit-form').hidden = true;
  document.querySelector('.stepper').hidden = true;
  $('progress').hidden = false;
  renderProgress('', body.skipAi);
  try {
    const { jobId } = await api('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    for (;;) {
      const job = await api(`/api/jobs/${jobId}`);
      if (job.state === 'failed') throw new Error(job.error);
      if (job.state === 'done') {
        activeTab = 'overview';
        window.location.hash = `#report/${job.reportId}`;
        return;
      }
      renderProgress(job.step, body.skipAi);
      await new Promise((resolve) => { setTimeout(resolve, 1500); });
    }
  } catch (error) {
    if (body.demo) {
      window.location.hash = '#/';
      return;
    }
    showError(error.message);
  } finally {
    $('progress').hidden = true;
    $('audit-form').hidden = false;
    document.querySelector('.stepper').hidden = false;
  }
}

/** On the showcase, a request is emailed to Viralyst with everything the visitor entered. */
function requestByEmail(values) {
  const lines = [
    `Audit type: ${values.audienceType === 'creator' ? 'Creator' : 'Business'}`,
    `Account to audit: ${values.a}`,
    `${values.audienceType === 'creator' ? 'Similar creators' : 'Competitors'}: ${values.competitors.join(', ') || 'none'}`,
    values.goal && `Main goal: ${values.goal}`,
    values.idealCustomer && `Ideal customer: ${values.idealCustomer}`,
    values.markets && `Markets: ${values.markets}`,
    values.notes && `Notes: ${values.notes}`,
  ].filter(Boolean);
  const subject = `Instagram audit request: ${values.a}`;
  const body = `Hi Viralyst,\n\nPlease audit this account.\n\n${lines.join('\n')}\n\nThanks`;
  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $('review').append(h('p', { class: 'success' }, `Your email app should open with the request ready to send. If it doesn't, email ${CONTACT_EMAIL} or DM @viralyst.t on Instagram.`));
}

$('audit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (STATIC_SITE) return requestByEmail(wizardValues());
  if (!status.apify) return showError('Real audits need an Apify token. Add it in Settings first.');
  runJob(wizardValues());
  return null;
});

// Personalised preview: the phone shows the handle as it's typed.
$('hero-handle').addEventListener('input', () => {
  const typed = $('hero-handle').value.trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').split(/[/?#]/)[0];
  $('phone-handle').textContent = `@${typed || 'yourbrand'}`;
});

// The self-check: a quick, honest gut check that points to the real audit.
const quizAnswers = new Map();
const QUIZ_RESULTS = [
  [0, 'Every answer points to reach you\'re probably missing. The audit shows exactly where.'],
  [40, 'A few big gaps. The audit ranks them so you fix the costly ones first.'],
  [70, 'Solid basics. The audit finds the smaller leaks and what your competitors do better.'],
  [100, 'Strong habits. The audit checks whether the numbers agree, and where to push next.'],
];
document.querySelectorAll('#quiz button').forEach((button) => {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    const question = button.dataset.q;
    quizAnswers.set(question, Number(button.dataset.a));
    button.parentElement.querySelectorAll('button').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    const answered = quizAnswers.size;
    const yes = [...quizAnswers.values()].reduce((sum, value) => sum + value, 0);
    const percent = Math.round((yes / 5) * 100);
    $('quiz-fill').style.width = `${Math.max(answered === 5 ? percent : (yes / answered) * 100, 4)}%`;
    if (answered < 5) {
      $('quiz-text').textContent = `${answered} of 5 answered`;
      return;
    }
    const message = [...QUIZ_RESULTS].reverse().find(([min]) => percent >= min)[1];
    $('quiz-text').textContent = `${yes} of 5. ${message}`;
    $('quiz-cta').hidden = false;
  });
});

// A slim call to action follows phone visitors once the hero is out of view.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    $('sticky-cta').hidden = entry.isIntersecting || $('page-home').hidden;
  }).observe(document.querySelector('.hero-split'));
}

$('hero-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const handle = $('hero-handle').value.trim();
  if (handle) $('input-a').value = handle;
  wizardStep = handle ? 2 : 1;
  window.location.hash = '#/new';
});

$('demo').addEventListener('click', () => {
  window.location.hash = '#/new';
  runJob({ demo: true, skipAi: true, audienceType: audienceMode });
});

// ---------- Reel checker ----------

let reelJobRunning = false;

function reelError(message) {
  $('reel-error').textContent = message;
  $('reel-error').hidden = !message;
}

async function waitForCheck(jobId) {
  for (;;) {
    const job = await api(`/api/jobs/${jobId}`);
    if (job.state === 'failed') throw new Error(job.error);
    if (job.state === 'done') return job.checkId;
    $('reel-progress-text').textContent = job.step || 'Working…';
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
  }
}

async function runReelCheck(start) {
  if (reelJobRunning) return;
  reelJobRunning = true;
  reelError('');
  $('reel-forms').hidden = true;
  $('reel-progress').hidden = false;
  $('reel-progress-text').textContent = 'Uploading…';
  $('reel-result').replaceChildren();
  try {
    const { jobId } = await start();
    const checkId = await waitForCheck(jobId);
    window.location.hash = `#reelcheck/${checkId}`;
  } catch (problem) {
    reelError(problem.message);
  } finally {
    reelJobRunning = false;
    $('reel-forms').hidden = false;
    $('reel-progress').hidden = true;
  }
}

$('reel-upload-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const file = $('reel-file').files[0];
  if (!file) return reelError('Choose a video file first.');
  if (file.size > 300 * 1024 * 1024) return reelError('That video is larger than 300 MB.');
  runReelCheck(async () => {
    const response = await fetch('/api/reel-checks/upload', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Reel-Name': encodeURIComponent($('reel-name').value.trim() || file.name.replace(/\.[^.]+$/, '')),
        'X-Reel-Goal': encodeURIComponent($('reel-goal').value.trim()),
        'X-Audience-Type': audienceMode,
        'X-Skip-Ai': String($('reel-skip-ai').checked),
      },
      body: file,
    });
    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('Please sign in again.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `The upload failed (${response.status}).`);
    return body;
  });
  return null;
});

$('reel-link-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = $('reel-link').value.trim();
  if (!url) return reelError('Paste the link to the Reel.');
  runReelCheck(() => api('/api/reel-checks/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name: $('reel-link-name').value.trim(), audienceType: audienceMode, skipAi: $('reel-skip-ai').checked }),
  }));
  return null;
});

function renderReelCheck(check) {
  const { stats, feedback, ai } = check;
  const review = ai?.review;
  const listBlock = (title, items, render) => (items?.length ? [h('h3', {}, title), h('ul', { class: 'plan-list' }, items.map(render))] : null);
  return h('div', { class: 'reel-check' },
    h('div', { class: 'card reel-check-head' },
      check.thumb ? h('img', { class: 'thumb', src: check.thumb, alt: 'First frame of the Reel' }) : h('div', { class: 'thumb thumb-empty' }, 'Video'),
      h('div', {},
        h('h2', {}, check.name),
        h('p', { class: 'note' }, `${check.source === 'link' ? 'Posted Reel' : 'Uploaded draft'} · ${Math.round(stats.seconds)}s · checked ${shortDate(check.createdAt)}`),
        check.goal && h('p', {}, h('strong', {}, 'Goal: '), check.goal),
        isInstagramUrl(check.link) && h('a', { href: check.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open on Instagram')),
      h('div', { class: 'reel-scores' },
        h('div', { class: `reel-score ${scoreTone(feedback.overall)}` }, h('strong', {}, String(feedback.overall)), h('span', {}, 'Measured')),
        review && h('div', { class: `reel-score ${scoreTone(review.overall_score)}` }, h('strong', {}, String(review.overall_score)), h('span', {}, 'AI review')))),
    ai?.state === 'failed' && h('div', { class: 'banner' }, h('strong', {}, 'AI review unavailable. '), ai.reason),
    section('Second by second', 'Energy combines movement, sound level and cuts. Dips are where viewers are most likely to swipe away.',
      h('div', { class: 'card' }, hookFacts(stats), timelineChart(stats, check.name), chartKey())),
    section('Score by part', null, h('div', { class: 'card' }, feedbackParts(feedback))),
    feedback.fixes.length > 0 && section('Fix these first', null, h('div', { class: 'card' }, h('ol', { class: 'actions-list' },
      feedback.fixes.map((item) => h('li', {}, h('strong', {}, item.fix), h('div', { class: 'note' }, item.part)))))),
    review && section('AI review', 'From sampled frames plus the measurements. The AI cannot hear the audio.', h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('p', { class: 'headline' }, review.summary),
        h('ul', { class: 'plan-list' }, review.parts.map((part) => h('li', {}, h('strong', {}, `${part.part} (${part.score}): `), part.comment)))),
      h('div', { class: 'card' },
        listBlock('Fixes', review.fixes, (fix) => h('li', {}, fix.at_seconds != null ? h('span', { class: 'beat-time' }, `${fix.at_seconds}s`) : null, fix.fix)),
        listBlock('Stronger opening lines', review.new_hooks, (line) => h('li', {}, line)),
        listBlock('Calls to action', review.cta_ideas, (line) => h('li', {}, line))))));
}

async function renderReelHistory(currentId) {
  const checks = await api('/api/reel-checks').catch(() => []);
  if (!checks.length) {
    $('reel-history').replaceChildren(h('p', { class: 'note' }, 'No Reels checked yet.'));
    return;
  }
  const best = Math.max(...checks.map((check) => check.measured));
  $('reel-history').replaceChildren(h('div', { class: 'card table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Reel'), h('th', {}, 'Checked'), h('th', { class: 'num' }, 'Length'), h('th', { class: 'num' }, 'Measured'), h('th', { class: 'num' }, 'AI review'))),
    h('tbody', {}, checks.map((check) => h('tr', { class: check.id === currentId ? 'current' : null },
      h('td', {}, h('a', { href: `#reelcheck/${check.id}` }, check.name), checks.length > 1 && check.measured === best && h('span', { class: 'lead-tag' }, 'Best')),
      h('td', {}, shortDate(check.createdAt)),
      h('td', { class: 'num' }, check.seconds != null ? `${Math.round(check.seconds)}s` : '–'),
      h('td', { class: 'num' }, String(check.measured)),
      h('td', { class: 'num' }, check.ai == null ? '–' : String(check.ai))))))));
}

// ---------- Settings ----------

$('keys-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('keys-error').hidden = true;
  $('keys-saved').hidden = true;
  $('save-keys').disabled = true;
  $('save-keys').textContent = 'Checking keys…';
  try {
    await api('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apifyToken: $('input-apify').value, anthropicKey: $('input-anthropic').value }),
    });
    $('input-apify').value = '';
    $('input-anthropic').value = '';
    $('keys-saved').hidden = false;
  } catch (error) {
    $('keys-error').textContent = error.message;
    $('keys-error').hidden = false;
  } finally {
    await loadStatus();
    $('save-keys').disabled = false;
    $('save-keys').textContent = 'Save keys';
  }
});

// ---------- Routing ----------

let loadedReport = null;

async function route() {
  const hash = window.location.hash;
  const match = hash.match(/^#report\/([0-9a-f-]{36})(?:\/([a-z]+))?$/);
  if (match) {
    try {
      if (loadedReport?.id !== match[1]) loadedReport = await api(`/api/reports/${match[1]}`);
      const changedReport = $('report').dataset.id !== match[1];
      renderReport(loadedReport, match[2] ?? (changedReport ? 'overview' : activeTab));
      $('report').dataset.id = match[1];
      showPage('report');
      if (changedReport) window.scrollTo(0, 0);
    } catch (error) {
      window.location.hash = '#/audits';
    }
    return;
  }
  const reelMatch = hash.match(/^#reelcheck\/([0-9a-f-]{36})$/);
  if (reelMatch) {
    showPage('reels');
    reelError('');
    try {
      $('reel-result').replaceChildren(renderReelCheck(await api(`/api/reel-checks/${reelMatch[1]}`)));
    } catch (problem) {
      reelError(problem.message);
    }
    renderReelHistory(reelMatch[1]);
    window.scrollTo(0, 0);
    return;
  }
  const page = { '#/new': 'new', '#/audits': 'audits', '#/reels': 'reels', '#/settings': 'settings' }[hash] ?? 'home';
  showPage(page);
  window.scrollTo(0, 0);
  if (page === 'home') {
    buildBars($('hero-bars'));
    watchReveals($('page-home'));
    startHeroPreview();
  }
  if (page === 'audits') renderAuditList();
  if (page === 'reels' && !reelJobRunning) {
    $('reel-result').replaceChildren();
    renderReelHistory();
  }
  if (page === 'new' && $('progress').hidden) setWizardStep(wizardStep);
  if (page === 'settings') { $('keys-saved').hidden = true; $('keys-error').hidden = true; }
}

window.addEventListener('hashchange', route);
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  window.location.href = '/login';
});
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('details.pillar').forEach((node) => { node.open = true; });
});

document.querySelectorAll('[data-set-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.setMode)));
setMode(audienceMode);
loadStatus();
route();
