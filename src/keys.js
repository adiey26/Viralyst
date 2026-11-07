import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { config, ENV_FILE } from './config.js';

const PRINTABLE = /^[\x21-\x7e]{1,512}$/;

/** Removes the spaces and quotes that often come along when copying a key. */
function cleanKey(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/** Returns the keys to save, or throws a readable error. Blank fields are ignored. */
export function validateKeys({ apifyToken, anthropicKey }) {
  const apify = cleanKey(apifyToken);
  const anthropic = cleanKey(anthropicKey);
  if (!apify && !anthropic) throw new Error('Please paste at least one key.');
  for (const key of [apify, anthropic]) {
    if (key && !PRINTABLE.test(key)) throw new Error('That key contains spaces or unusual characters. Please copy it again.');
  }
  if (apify.startsWith('sk-ant-')) throw new Error('The Apify box contains an Anthropic key. Please swap them.');
  if (anthropic.startsWith('apify_api_')) throw new Error('The Anthropic box contains an Apify token. Please swap them.');

  const updates = {};
  if (apify) updates.APIFY_TOKEN = apify;
  if (anthropic) updates.ANTHROPIC_API_KEY = anthropic;
  return updates;
}

/** Replaces each setting's line, or adds one, and leaves everything else in the file alone. */
export function updateEnvText(text, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = text.split(/\r?\n/).map((line) => {
    const name = line.match(/^\s*([A-Z_]+)\s*=/)?.[1];
    if (!name || !remaining.has(name)) return line;
    const value = remaining.get(name);
    remaining.delete(name);
    return `${name}=${value}`;
  });
  while (lines.length && lines.at(-1) === '') lines.pop();
  for (const [name, value] of remaining) lines.push(`${name}=${value}`);
  return `${lines.join('\n')}\n`;
}

/** Returns a problem message if Apify rejects the token. Outages aren't treated as a bad token. */
export async function checkApifyToken(token, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) {
      return 'Apify did not accept this token. Copy the "Personal API token" from the Apify integrations page.';
    }
  } catch {
    // Could not reach Apify, so the token can't be judged either way.
  }
  return null;
}

/** Returns a problem message if Anthropic rejects the key. This lists models, which uses no credit. */
export async function checkAnthropicKey(key, { makeClient = (apiKey) => new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }) } = {}) {
  try {
    await makeClient(key).models.list({ limit: 1 });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return 'Anthropic did not accept this key. Create one in the Claude Console under API keys. A Claude.ai subscription or Claude Code login is not an API key.';
    }
  }
  return null;
}

/**
 * Saves each accepted key to .env and applies it straight away, so no restart is needed.
 * A rejected key isn't saved, and its message is thrown after the good key is kept.
 */
export async function saveKeys(input, { file = ENV_FILE, checkApify = checkApifyToken, checkAnthropic = checkAnthropicKey } = {}) {
  const updates = validateKeys(input);
  const problems = [];
  if (updates.APIFY_TOKEN) {
    const problem = await checkApify(updates.APIFY_TOKEN);
    if (problem) {
      problems.push(problem);
      delete updates.APIFY_TOKEN;
    }
  }
  if (updates.ANTHROPIC_API_KEY) {
    const problem = await checkAnthropic(updates.ANTHROPIC_API_KEY);
    if (problem) {
      problems.push(problem);
      delete updates.ANTHROPIC_API_KEY;
    }
  }
  if (Object.keys(updates).length) writeAndApply(updates, file);
  if (problems.length) throw new Error(problems.join(' '));
}

function writeAndApply(updates, file) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, updateEnvText(current, updates), { mode: 0o600 });

  if (updates.APIFY_TOKEN) {
    process.env.APIFY_TOKEN = updates.APIFY_TOKEN;
    config.apifyToken = updates.APIFY_TOKEN;
  }
  if (updates.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = updates.ANTHROPIC_API_KEY;
    config.hasAnthropicKey = true;
  }
}
