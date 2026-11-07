import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearedCookie, createLoginLimiter, createSessions, passwordMatches, readCookie, sessionCookie } from '../src/auth.js';

test('passwords are compared exactly, and an empty expected password never matches', () => {
  assert.equal(passwordMatches('secret', 'secret'), true);
  assert.equal(passwordMatches('Secret', 'secret'), false);
  assert.equal(passwordMatches('', ''), false);
  assert.equal(passwordMatches('anything', ''), false);
});

test('sessions are signed, expire, and cannot be forged', () => {
  let clock = 1_000_000;
  const sessions = createSessions({ secret: 'test-secret', now: () => clock });
  const token = sessions.issue();
  assert.equal(sessions.isValid(token), true);

  const [expires] = token.split('.');
  assert.equal(sessions.isValid(`${Number(expires) + 1}.${token.split('.')[1]}`), false, 'changing the expiry breaks the signature');
  assert.equal(sessions.isValid(`${expires}.forged`), false);
  assert.equal(sessions.isValid(''), false);
  assert.equal(sessions.isValid(null), false);
  assert.equal(createSessions({ secret: 'other-secret', now: () => clock }).isValid(token), false, 'a different secret rejects it');

  clock += 15 * 86_400_000;
  assert.equal(sessions.isValid(token), false, 'expired after 14 days');
});

test('repeated wrong passwords are blocked for 15 minutes', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ now: () => clock });
  for (let i = 0; i < 10; i += 1) limiter.recordFailure('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), true);
  assert.equal(limiter.isBlocked('5.6.7.8'), false, 'other visitors are unaffected');
  clock += 16 * 60 * 1000;
  assert.equal(limiter.isBlocked('1.2.3.4'), false);
  limiter.recordFailure('5.6.7.8');
  limiter.reset('5.6.7.8');
  assert.equal(limiter.isBlocked('5.6.7.8'), false);
});

test('cookies are read and written safely', () => {
  assert.equal(readCookie('a=1; viralyst_session=abc.def; b=2', 'viralyst_session'), 'abc.def');
  assert.equal(readCookie('', 'viralyst_session'), null);
  const cookie = sessionCookie('abc.def', { secure: true, maxAgeSeconds: 60 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(sessionCookie('x', { secure: false, maxAgeSeconds: 60 }), /Secure/);
  assert.match(clearedCookie({ secure: false }), /Max-Age=0/);
});
