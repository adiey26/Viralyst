import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ENV_FILE = process.env.ENV_FILE || path.join(ROOT, '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 4173),
  apifyToken: process.env.APIFY_TOKEN?.trim() || '',
  hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()),
  model: 'claude-opus-5-5',
  postsPerAccount: int(process.env.POSTS_PER_ACCOUNT, 60),
  includeShares: process.env.INCLUDE_SHARES === 'true',
  commentsPerPost: int(process.env.COMMENTS_PER_POST, 25),
  apifyMaxUsdPerRun: Number(process.env.APIFY_MAX_USD_PER_RUN) > 0 ? Number(process.env.APIFY_MAX_USD_PER_RUN) : 1,
  includeTranscripts: process.env.INCLUDE_TRANSCRIPTS === 'true',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),
  // Hosted mode: the app is reachable from the internet, so it requires a password and keys come from the host.
  hosted: Boolean(process.env.RENDER || process.env.HOSTED === 'true'),
  listenHost: process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1'),
  appPassword: process.env.APP_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  publicHosts: [process.env.RENDER_EXTERNAL_HOSTNAME, ...(process.env.ALLOWED_HOSTS ?? '').split(',')]
    .map((host) => host?.trim().toLowerCase()).filter(Boolean),
};
