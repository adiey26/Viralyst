const USERNAME = /^[a-z0-9._]{1,30}$/;
const NON_PROFILE_PATHS = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct']);

/** Turns a profile link, @name or bare name into a lowercase username. Throws a readable error otherwise. */
export function parseHandle(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Please enter an Instagram profile link or username.');

  let candidate = raw.replace(/^@/, '');
  if (/instagram\.com/i.test(raw)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw new Error(`"${raw}" is not a valid Instagram link.`);
    }
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) throw new Error(`"${raw}" is not an Instagram link.`);
    const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!first || NON_PROFILE_PATHS.has(first.toLowerCase())) {
      throw new Error(`"${raw}" looks like a post or page link. Please paste the company's profile link instead.`);
    }
    candidate = first;
  }

  const handle = candidate.toLowerCase();
  if (!USERNAME.test(handle)) throw new Error(`"${raw}" is not a valid Instagram username.`);
  return handle;
}
