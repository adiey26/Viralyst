import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { checkAnthropicKey, checkApifyToken, saveKeys, updateEnvText, validateKeys } from '../src/keys.js';
import { config } from '../src/config.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'insta-audit-keys-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const accept = async () => null;
const reject = (message) => async () => message;
let saved;
beforeEach(() => { saved = { token: config.apifyToken, has: config.hasAnthropicKey }; });
afterEach(() => {
  config.apifyToken = saved.token;
  config.hasAnthropicKey = saved.has;
  delete process.env.APIFY_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
});

test('validateKeys cleans pasted keys and ignores blank fields', () => {
  assert.deepEqual(validateKeys({ apifyToken: '  "abc123"\n', anthropicKey: '' }), { APIFY_TOKEN: 'abc123' });
  assert.deepEqual(validateKeys({ anthropicKey: " 'sk-ant-x' " }), { ANTHROPIC_API_KEY: 'sk-ant-x' });
});

test('validateKeys rejects empty, malformed and swapped keys', () => {
  assert.throws(() => validateKeys({}), /at least one/);
  assert.throws(() => validateKeys({ apifyToken: 'two words' }), /copy it again/);
  assert.throws(() => validateKeys({ apifyToken: 'abc\nEVIL=1' }), /copy it again/);
  assert.throws(() => validateKeys({ apifyToken: 'sk-ant-x' }), /swap/);
  assert.throws(() => validateKeys({ anthropicKey: 'apify_api_x' }), /swap/);
});

test('updateEnvText replaces or adds settings and keeps everything else', () => {
  const before = '# Comment\r\nAPIFY_TOKEN=\r\n# PORT=4173\r\nPORT=5000\r\n';
  assert.equal(
    updateEnvText(before, { APIFY_TOKEN: 'new', ANTHROPIC_API_KEY: 'key' }),
    '# Comment\nAPIFY_TOKEN=new\n# PORT=4173\nPORT=5000\nANTHROPIC_API_KEY=key\n',
  );
  assert.equal(updateEnvText('', { APIFY_TOKEN: 'a' }), 'APIFY_TOKEN=a\n');
});

test('accepted keys are written and take effect without a restart', async () => {
  const file = path.join(dir, 'good.env');
  writeFileSync(file, 'PORT=5000\n');
  await saveKeys({ apifyToken: 'first', anthropicKey: 'second' }, { file, checkApify: accept, checkAnthropic: accept });
  assert.equal(readFileSync(file, 'utf8'), 'PORT=5000\nAPIFY_TOKEN=first\nANTHROPIC_API_KEY=second\n');
  assert.equal(config.apifyToken, 'first');
  assert.equal(config.hasAnthropicKey, true);
  assert.equal(process.env.ANTHROPIC_API_KEY, 'second');

  await saveKeys({ apifyToken: 'changed' }, { file, checkApify: accept, checkAnthropic: accept });
  assert.equal(readFileSync(file, 'utf8'), 'PORT=5000\nAPIFY_TOKEN=changed\nANTHROPIC_API_KEY=second\n');
});

test('a rejected key is not saved, while a good key alongside it is kept', async () => {
  const file = path.join(dir, 'mixed.env');
  await assert.rejects(
    saveKeys({ apifyToken: 'good', anthropicKey: 'bad' }, { file, checkApify: accept, checkAnthropic: reject('Bad Anthropic key') }),
    /Bad Anthropic key/,
  );
  assert.equal(readFileSync(file, 'utf8'), 'APIFY_TOKEN=good\n');
  assert.equal(config.apifyToken, 'good');

  const untouched = path.join(dir, 'none.env');
  await assert.rejects(saveKeys({ apifyToken: 'bad' }, { file: untouched, checkApify: reject('Bad token'), checkAnthropic: accept }), /Bad token/);
  assert.equal(existsSync(untouched), false);
});

test('checkApifyToken rejects only when Apify refuses the token', async () => {
  const withStatus = (status) => ({ fetchImpl: async () => new Response('{}', { status }) });
  assert.equal(await checkApifyToken('t', withStatus(200)), null);
  assert.match(await checkApifyToken('t', withStatus(401)), /did not accept/);
  assert.equal(await checkApifyToken('t', withStatus(500)), null, 'an outage is not a bad token');
  assert.equal(await checkApifyToken('t', { fetchImpl: async () => { throw new Error('offline'); } }), null);
});

test('checkAnthropicKey rejects only when Anthropic refuses the key', async () => {
  const failingWith = (error) => ({ makeClient: () => ({ models: { list: async () => { throw error; } } }) });
  const headers = new Headers();
  assert.equal(await checkAnthropicKey('k', { makeClient: () => ({ models: { list: async () => ({}) } }) }), null);
  assert.match(await checkAnthropicKey('k', failingWith(new Anthropic.AuthenticationError(401, {}, 'no', headers))), /subscription/);
  assert.equal(await checkAnthropicKey('k', failingWith(new Anthropic.RateLimitError(429, {}, 'slow', headers))), null);
  assert.equal(await checkAnthropicKey('k', failingWith(new Error('offline'))), null);
});
