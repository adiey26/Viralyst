import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 14;
export const COOKIE_NAME = 'viralyst_session';
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** Compares two strings in constant time, so response timing can't reveal the password. */
export function passwordMatches(given, expected) {
  if (!expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function createSessions({ secret = randomBytes(32).toString('hex'), now = () => Date.now() } = {}) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    issue() {
      const expires = String(now() + SESSION_DAYS * 86_400_000);
      return `${expires}.${sign(expires)}`;
    },

    isValid(token) {
      const [expires, signature] = String(token ?? '').split('.');
      if (!expires || !signature || !/^\d+$/.test(expires)) return false;
      const expected = Buffer.from(sign(expires));
      const actual = Buffer.from(signature);
      return expected.length === actual.length && timingSafeEqual(expected, actual) && Number(expires) > now();
    },

    maxAgeSeconds: SESSION_DAYS * 86_400,
  };
}

/** Limits password guesses per visitor to slow down anyone trying to guess it. */
export function createLoginLimiter({ now = () => Date.now() } = {}) {
  const attempts = new Map();
  const recent = (key) => (attempts.get(key) ?? []).filter((time) => now() - time < ATTEMPT_WINDOW_MS);
  return {
    isBlocked: (key) => recent(key).length >= MAX_ATTEMPTS,
    recordFailure(key) {
      attempts.set(key, [...recent(key), now()]);
    },
    reset: (key) => attempts.delete(key),
  };
}

export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token, { secure, maxAgeSeconds }) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function clearedCookie({ secure }) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
