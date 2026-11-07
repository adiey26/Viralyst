import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PLATFORMS = [
  [/(^|\.)(youtube\.com|youtu\.be)$/i, 'YouTube'],
  [/(^|\.)(wa\.me|whatsapp\.com)$/i, 'WhatsApp'],
  [/(^|\.)(facebook\.com|fb\.me)$/i, 'Facebook'],
  [/(^|\.)instagram\.com$/i, 'Instagram'],
  [/(^|\.)(t\.me|telegram\.me)$/i, 'Telegram'],
  [/(^|\.)(twitter\.com|x\.com)$/i, 'X'],
  [/(^|\.)tiktok\.com$/i, 'TikTok'],
  [/(^|\.)linkedin\.com$/i, 'LinkedIn'],
];
const platformOf = (hostname) => PLATFORMS.find(([pattern]) => pattern.test(hostname))?.[1] ?? null;
const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LINK_PAGES = /(^|\.)(linktr\.ee|beacons\.ai|bio\.link|taplink\.cc|linkin\.bio|lnk\.bio|campsite\.bio|solo\.to|stan\.store|linkpop\.com|hoo\.be)$/i;

/** True for loopback, private, link-local and other addresses a public website would never use. */
export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
  }
  return true;
}

/** Bio links are written by the account owner, so they must never reach this computer or its network. */
async function assertPublicUrl(url, resolve) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported link type.');
  if (url.username || url.password) throw new Error('Unsupported link.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await resolve(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('This link points to a private address.');
  }
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reads what a page reveals. "Not found" is not proof of absence, since tag managers can hide scripts. */
export function inspectHtml(html) {
  const lower = html.toLowerCase();
  return {
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? null,
    description: html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1]?.slice(0, 300) ?? null,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasMetaPixel: /fbevents\.js|\bfbq\s*\(/i.test(html),
    hasAnalytics: /googletagmanager\.com|google-analytics\.com|\bgtag\s*\(|plausible\.io|clarity\.ms|hotjar/i.test(html),
    hasTagManager: lower.includes('googletagmanager.com/gtm.js'),
    hasCheckout: /add to cart|add-to-cart|checkout|shopify|woocommerce|razorpay/i.test(html),
    hasLeadCapture: /<form\b|wa\.me\/|api\.whatsapp\.com|calendly\.com|tel:|mailto:/i.test(html),
    text: visibleText(html).slice(0, 2000),
  };
}

export async function checkLanding(rawUrl, { fetchImpl = fetch, resolve = lookup } = {}) {
  if (!rawUrl) return { present: false };
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { present: true, ok: false, error: 'The link is not valid.' };
  }
  const startUrl = url.href;
  const hasUtm = (value) => /[?&]utm_[a-z]+=/i.test(value);
  const startedAt = Date.now();
  try {
    let hops = 0;
    for (;;) {
      await assertPublicUrl(url, resolve);
      const response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': BROWSER_AGENT, Accept: 'text/html' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (hops >= MAX_REDIRECTS) return { present: true, ok: false, error: 'The link redirects too many times.' };
        hops += 1;
        url = new URL(location, url);
        continue;
      }
      const isHtml = (response.headers.get('content-type') ?? '').includes('html');
      const html = isHtml ? await readLimited(response) : '';
      return {
        present: true,
        ok: response.ok,
        status: response.status,
        startUrl,
        finalUrl: url.href,
        hops,
        responseMs: Date.now() - startedAt,
        https: url.protocol === 'https:',
        isLinkPage: LINK_PAGES.test(url.hostname),
        platform: platformOf(url.hostname),
        hasUtm: hasUtm(startUrl) || hasUtm(url.href),
        ...inspectHtml(html),
      };
    }
  } catch (error) {
    return { present: true, ok: false, error: error.name === 'TimeoutError' ? 'The page took too long to respond.' : error.message };
  }
}
