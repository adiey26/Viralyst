const SVG_NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

const tooltip = () => document.getElementById('tooltip');

function showTooltip(event, title, lines) {
  const tip = tooltip();
  tip.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = title;
  tip.append(heading);
  for (const line of lines) {
    const span = document.createElement('span');
    span.textContent = line;
    tip.append(span);
  }
  tip.hidden = false;
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const x = event.clientX || (rect ? rect.left + rect.width / 2 : 0);
  const y = event.clientY || (rect ? rect.top : 0);
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - box.height - 8))}px`;
}

const hideTooltip = () => { tooltip().hidden = true; };

/** Mouse and keyboard users get the same tooltip. */
function withTooltip(node, getContent) {
  const show = (event) => {
    const { title, lines } = getContent();
    showTooltip(event, title, lines);
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointermove', show);
  node.addEventListener('pointerleave', hideTooltip);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hideTooltip);
  node.setAttribute('tabindex', '0');
  const { title, lines } = getContent();
  node.setAttribute('aria-label', `${title}. ${lines.join('. ')}`);
  return node;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function logTicks(min, max) {
  const ticks = [];
  for (let power = Math.floor(Math.log10(min)); power <= Math.ceil(Math.log10(max)); power += 1) {
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** power;
      if (value >= min && value <= max) ticks.push(value);
    }
  }
  return ticks.length > 7 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
}

function marker(series, x, y) {
  if (series === 'a') return s('circle', { cx: x, cy: y, r: 4.5, class: 'fill-a ring' });
  return s('rect', { x: x - 4, y: y - 4, width: 8, height: 8, rx: 1.5, class: 'fill-b ring' });
}

/** Each dot is a Reel. A log scale keeps ordinary Reels readable beside a viral one. */
export function viewsScatter(seriesA, seriesB, describe) {
  const width = 960;
  const height = 340;
  const m = { top: 12, right: 16, bottom: 28, left: 52 };
  const all = [...seriesA.map((p) => ({ ...p, series: 'a' })), ...seriesB.map((p) => ({ ...p, series: 'b' }))]
    .filter((p) => p.views > 0 && p.timestamp);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Views of each Reel over time, for both companies' });
  if (!all.length) return svg;

  const times = all.map((p) => new Date(p.timestamp).getTime());
  const views = all.map((p) => p.views);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const vMin = Math.min(...views) * 0.8;
  const vMax = Math.max(...views) * 1.2;
  const x = (t) => m.left + ((t - tMin) / Math.max(tMax - tMin, 1)) * (width - m.left - m.right);
  const y = (v) => height - m.bottom - ((Math.log10(v) - Math.log10(vMin)) / (Math.log10(vMax) - Math.log10(vMin))) * (height - m.top - m.bottom);

  for (const tick of logTicks(vMin, vMax)) {
    svg.append(s('line', { x1: m.left, x2: width - m.right, y1: y(tick), y2: y(tick), class: 'gridline' }));
    svg.append(s('text', { x: m.left - 8, y: y(tick) + 4, 'text-anchor': 'end' }, compact.format(tick)));
  }
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  for (let i = 0; i <= 4; i += 1) {
    const t = tMin + ((tMax - tMin) * i) / 4;
    const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
    svg.append(s('text', { x: x(t), y: height - 8, 'text-anchor': anchor }, fmt.format(t)));
  }
  svg.append(s('line', { x1: m.left, x2: width - m.right, y1: height - m.bottom, y2: height - m.bottom, class: 'axisline' }));

  for (const post of all) {
    const px = x(new Date(post.timestamp).getTime());
    const py = y(post.views);
    svg.append(marker(post.series, px, py));
  }
  for (const post of all) {
    const px = x(new Date(post.timestamp).getTime());
    const py = y(post.views);
    svg.append(withTooltip(s('circle', { cx: px, cy: py, r: 12, class: 'hit' }), () => describe(post)));
  }
  return svg;
}

/** Paired horizontal bars for one breakdown. Faded bars rest on fewer than 3 posts. */
export function pairedBars(rowsA, rowsB, { format, referenceAt = null, referenceLabel = '', nameA, nameB }) {
  const rows = rowsA.map((row, i) => ({ label: row.label, a: row, b: rowsB[i] })).filter((row) => row.a.n || row.b.n);
  const rowHeight = 50;
  const width = 480;
  const m = { top: referenceAt != null ? 22 : 4, right: 92, bottom: 4, left: 142 };
  const height = m.top + rows.length * rowHeight + m.bottom;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'group' });
  const values = rows.flatMap((row) => [row.a.value, row.b.value]).filter(Number.isFinite);
  const max = Math.max(...values, referenceAt ?? 0) || 1;
  const x = (v) => m.left + (v / max) * (width - m.left - m.right);

  if (referenceAt != null) {
    svg.append(s('line', { x1: x(referenceAt), x2: x(referenceAt), y1: m.top - 3, y2: height - m.bottom, class: 'refline' }));
    svg.append(s('text', { x: x(referenceAt), y: 14, 'text-anchor': 'middle' }, referenceLabel));
  }

  rows.forEach((row, i) => {
    const top = m.top + i * rowHeight;
    svg.append(s('text', { x: m.left - 10, y: top + 25, 'text-anchor': 'end', class: 'category' }, row.label));
    [['a', row.a, top + 6, nameA], ['b', row.b, top + 26, nameB]].forEach(([series, data, barY, name]) => {
      const barHeight = 16;
      if (!Number.isFinite(data.value)) {
        svg.append(s('text', { x: m.left + 4, y: barY + 12 }, 'no posts'));
        return;
      }
      const end = Math.max(x(data.value), m.left + 3);
      svg.append(s('rect', {
        x: m.left, y: barY, width: end - m.left, height: barHeight, rx: 3,
        class: `fill-${series}${data.lowSample ? ' low-sample' : ''}`,
      }));
      svg.append(s('text', { x: end + 6, y: barY + 12, class: 'value' }, `${format(data.value)}, ${data.n} post${data.n === 1 ? '' : 's'}`));
      svg.append(withTooltip(s('rect', { x: m.left, y: barY - 2, width: width - m.left - m.right + 4, height: barHeight + 4, class: 'hit' }), () => ({
        title: `${name}: ${row.label}`,
        lines: [`${format(data.value)} from ${data.n} post${data.n === 1 ? '' : 's'}`, ...(data.lowSample ? ['Too few posts to rely on'] : [])],
      })));
    });
  });
  return svg;
}

/** Both accounts start at 100, so different audience sizes can share one axis. */
export function growthChart(seriesA, seriesB, nameA, nameB) {
  const width = 960;
  const height = 300;
  const m = { top: 14, right: 150, bottom: 28, left: 52 };
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Follower growth, both companies indexed to 100 at the start' });
  const indexed = [[seriesA, 'a', nameA], [seriesB, 'b', nameB]]
    .filter(([series]) => series.length >= 2)
    .map(([series, id, name]) => ({
      id,
      name,
      points: series.map((point) => ({
        t: new Date(point.takenAt).getTime(),
        followers: point.followers,
        value: (point.followers / series[0].followers) * 100,
      })),
    }));
  if (!indexed.length) return svg;

  const points = indexed.flatMap((line) => line.points);
  const tMin = Math.min(...points.map((p) => p.t));
  const tMax = Math.max(...points.map((p) => p.t));
  const low = Math.min(100, ...points.map((p) => p.value));
  const high = Math.max(100, ...points.map((p) => p.value));
  const pad = Math.max((high - low) * 0.1, 0.1);
  const vMin = low - pad;
  const vMax = high + pad;
  const x = (t) => m.left + ((t - tMin) / Math.max(tMax - tMin, 1)) * (width - m.left - m.right);
  const y = (v) => height - m.bottom - ((v - vMin) / (vMax - vMin)) * (height - m.top - m.bottom);

  for (let i = 0; i <= 4; i += 1) {
    const value = vMin + ((vMax - vMin) * i) / 4;
    svg.append(s('line', { x1: m.left, x2: width - m.right, y1: y(value), y2: y(value), class: 'gridline' }));
    svg.append(s('text', { x: m.left - 8, y: y(value) + 4, 'text-anchor': 'end' }, value.toFixed(1)));
  }
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  for (let i = 0; i <= 3; i += 1) {
    const t = tMin + ((tMax - tMin) * i) / 3;
    svg.append(s('text', { x: x(t), y: height - 8, 'text-anchor': i === 0 ? 'start' : i === 3 ? 'end' : 'middle' }, fmt.format(t)));
  }

  for (const line of indexed) {
    const d = line.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    svg.append(s('path', { d, class: `line-${line.id}` }));
    const last = line.points.at(-1);
    svg.append(s('text', { x: x(last.t) + 8, y: y(last.value) + 4, class: 'value' }, `+${(last.value - 100).toFixed(1)}%`));
  }

  const cross = s('line', { y1: m.top, y2: height - m.bottom, class: 'crosshair', visibility: 'hidden' });
  svg.append(cross);
  const times = [...new Set(points.map((p) => p.t))].sort((p, q) => p - q);
  const bandWidth = Math.max((width - m.left - m.right) / Math.max(times.length - 1, 1), 6);
  const near = (line, t) => line.points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best));
  for (const t of times) {
    const band = withTooltip(s('rect', { x: x(t) - bandWidth / 2, y: m.top, width: bandWidth, height: height - m.top - m.bottom, class: 'hit' }), () => ({
      title: fmt.format(t),
      lines: indexed.map((line) => `${line.name}: ${near(line, t).followers.toLocaleString('en-US')} followers`),
    }));
    const show = () => {
      cross.setAttribute('x1', x(t));
      cross.setAttribute('x2', x(t));
      cross.setAttribute('visibility', 'visible');
    };
    const hide = () => cross.setAttribute('visibility', 'hidden');
    band.addEventListener('pointerenter', show);
    band.addEventListener('focus', show);
    band.addEventListener('pointerleave', hide);
    band.addEventListener('blur', hide);
    band.setAttribute('tabindex', '-1');
    svg.append(band);
  }
  return svg;
}
