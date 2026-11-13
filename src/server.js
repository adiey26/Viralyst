import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fetchSnapshot } from './apify.js';
import { appendToReport, listReports, loadReport, openTracker, runDemoAudit, runLiveAudit, saveInputs, THUMBS_DIR } from './audit.js';
import { chatAboutReport, generateIdeas, writeBrandPitch, writeScript } from './assistant.js';
import { renderMediaKit } from './mediakit.js';
import { checkLinkedReel, checkUploadedReel, listReelChecks, loadReelCheck } from './reelchecks.js';
import { config } from './config.js';
import { parseHandle } from './handles.js';
import { saveKeys } from './keys.js';
import { clearedCookie, COOKIE_NAME, createLoginLimiter, createSessions, passwordMatches, readCookie, sessionCookie } from './auth.js';

const BODY_LIMIT = 64 * 1024;
const MAX_COMPETITORS = 5;
const SNAPSHOT_CHECK_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_AGE_MS = 20 * 60 * 60 * 1000;
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/charts.js': ['charts.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/login': ['login.html', 'text/html; charset=utf-8'],
  '/login.js': ['login.js', 'text/javascript; charset=utf-8'],
  '/mediakit.css': ['mediakit.css', 'text/css; charset=utf-8'],
  '/mediakit.js': ['mediakit.js', 'text/javascript; charset=utf-8'],
};
// Pages a signed-out visitor may load: the sign-in page and what it needs to display.
const PUBLIC_PATHS = new Set(['/login', '/login.js', '/style.css', '/favicon.svg', '/healthz', '/api/login']);
const IMAGE_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // A local tool changes with each update, so browsers must always fetch the current pages.
  'Cache-Control': 'no-store',
};

const jobs = new Map();
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const sessions = createSessions(config.sessionSecret ? { secret: config.sessionSecret } : {});
const loginLimiter = createLoginLimiter();
const loginRequired = config.hosted || Boolean(config.appPassword);

if (config.hosted && !config.appPassword) {
  console.error('APP_PASSWORD must be set when the app is hosted online. Add it in your hosting settings.');
  process.exit(1);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

function startJob(run) {
  const id = randomUUID();
  const job = { id, state: 'running', step: 'Starting', reportId: null, error: null };
  jobs.set(id, job);
  run((step) => { job.step = step; })
    .then((result) => {
      job.state = 'done';
      if (result?.accounts) job.reportId = result.id;
      else job.checkId = result?.id ?? null;
    })
    .catch((error) => {
      console.error('Audit failed:', error);
      job.state = 'failed';
      job.error = error.message;
    });
  return job;
}

async function createAudit(req, res) {
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Could not read the request.' });
  }
  const timezone = validTimezone(String(input.timezone ?? 'UTC'));
  const notes = String(input.notes ?? '').slice(0, 2000);
  const text = (value) => String(value ?? '').trim().slice(0, 500);
  const brief = { goal: text(input.goal), idealCustomer: text(input.idealCustomer), markets: text(input.markets) };
  const audienceType = input.audienceType === 'creator' ? 'creator' : 'business';

  if (input.demo === true) {
    return send(res, 202, { jobId: startJob((progress) => runDemoAudit({ timezone, notes, brief, audienceType }, progress)).id });
  }

  let a;
  let competitors;
  try {
    a = parseHandle(input.a);
    const entered = Array.isArray(input.competitors) ? input.competitors.filter((value) => String(value ?? '').trim()) : [];
    if (!entered.length && audienceType === 'business') return send(res, 400, { error: 'Please enter at least one competitor.' });
    if (entered.length > MAX_COMPETITORS) return send(res, 400, { error: `Please enter up to ${MAX_COMPETITORS} competitors.` });
    competitors = entered.map(parseHandle);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
  if (new Set([a, ...competitors]).size !== competitors.length + 1) return send(res, 400, { error: 'Please enter different companies.' });
  if (!config.apifyToken) {
    return send(res, 400, { error: config.hosted ? 'No Apify token is set. Add APIFY_TOKEN in your hosting settings.' : 'No Apify token is set. Add it in Settings, or view the sample report.' });
  }
  return send(res, 202, { jobId: startJob((progress) => runLiveAudit({ a, competitors, notes, brief, timezone, skipAi: input.skipAi === true, audienceType }, progress)).id });
}

async function updateKeys(req, res) {
  if (config.hosted) return send(res, 403, { error: 'Keys for the hosted app are set in your hosting settings, not here.' });
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Could not read the request.' });
  }
  try {
    await saveKeys(input);
  } catch (error) {
    if (error.code) {
      console.error(`Could not save keys: ${error.code}`);
      return send(res, 500, { error: 'The keys could not be saved to the .env file.' });
    }
    return send(res, 400, { error: error.message });
  }
  takeDueSnapshots().catch(console.error);
  return send(res, 200, { apify: Boolean(config.apifyToken), anthropic: config.hasAnthropicKey });
}

/**
 * On this computer, only local addresses are accepted, which blocks other websites and rebinding hostnames.
 * When hosted, the site's own hostname is accepted as well, and the password protects the rest.
 */
function isAllowedHost(req) {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (host === `127.0.0.1:${config.port}` || host === `localhost:${config.port}`) return true;
  if (!config.hosted) return false;
  return !config.publicHosts.length || config.publicHosts.includes(host.replace(/:\d+$/, ''));
}

/** Requests that change something must come from this site's own pages. */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return !config.hosted;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https';
const clientKey = (req) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();

async function login(req, res) {
  const key = clientKey(req);
  if (loginLimiter.isBlocked(key)) return send(res, 429, { error: 'Too many attempts. Please wait 15 minutes and try again.' });
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Could not read the request.' });
  }
  if (!passwordMatches(String(input.password ?? ''), config.appPassword)) {
    loginLimiter.recordFailure(key);
    return send(res, 401, { error: 'That password is not right.' });
  }
  loginLimiter.reset(key);
  res.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(sessions.issue(), { secure: isSecure(req), maxAgeSeconds: sessions.maxAgeSeconds }) });
  return res.end(JSON.stringify({ ok: true }));
}

async function updateInputs(req, res, id) {
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Could not read the request.' });
  }
  try {
    const report = saveInputs(id, input.inputs);
    return report ? send(res, 200, report) : send(res, 404, { error: 'Report not found.' });
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
}

async function readJson(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: 'Could not read the request.' });
    return null;
  }
}

/** Streams an uploaded video to a temporary file, stopping at the size limit. */
function saveUpload(req) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'viralyst-upload-'));
    const file = path.join(dir, 'upload.mp4');
    const out = createWriteStream(file);
    let size = 0;
    const fail = (error) => {
      out.destroy();
      rmSync(dir, { recursive: true, force: true });
      reject(error);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        req.destroy();
        fail(new Error('That video is larger than 300 MB.'));
      }
    });
    req.on('error', fail);
    req.pipe(out);
    out.on('finish', () => (size ? resolve({ dir, file }) : fail(new Error('The upload was empty.'))));
  });
}

async function reelCheckUpload(req, res) {
  const type = req.headers['content-type'] ?? '';
  if (!/^(video\/|application\/octet-stream)/.test(type)) return send(res, 415, { error: 'Please upload a video file, such as MP4 or MOV.' });
  let upload;
  try {
    upload = await saveUpload(req);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
  const options = {
    name: decodeURIComponent(String(req.headers['x-reel-name'] ?? '')).slice(0, 80),
    goal: decodeURIComponent(String(req.headers['x-reel-goal'] ?? '')).slice(0, 300),
    audienceType: req.headers['x-audience-type'] === 'business' ? 'business' : 'creator',
    useAi: config.hasAnthropicKey && req.headers['x-skip-ai'] !== 'true',
  };
  const job = startJob((progress) => checkUploadedReel(upload.file, options, progress)
    .finally(() => rmSync(upload.dir, { recursive: true, force: true })));
  return send(res, 202, { jobId: job.id });
}

async function reelCheckLink(req, res) {
  const input = await readJson(req, res);
  if (!input) return null;
  if (!config.apifyToken) return send(res, 400, { error: 'Checking a posted Reel needs an Apify token. You can upload the video file instead.' });
  const options = {
    name: String(input.name ?? '').slice(0, 80),
    goal: String(input.goal ?? '').slice(0, 300),
    audienceType: input.audienceType === 'business' ? 'business' : 'creator',
    useAi: config.hasAnthropicKey && input.skipAi !== true,
  };
  try {
    (await import('./reelchecks.js')).parseReelLink(input.url);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
  return send(res, 202, { jobId: startJob((progress) => checkLinkedReel(input.url, options, progress)).id });
}

/** AI tools that work from a saved report. Results that are worth keeping are saved onto it. */
async function reportTool(req, res, id, tool) {
  const report = loadReport(id);
  if (!report) return send(res, 404, { error: 'Report not found.' });
  if (!config.hasAnthropicKey) return send(res, 400, { error: 'This needs a working Anthropic key. Add one in Settings.' });
  const input = await readJson(req, res);
  if (!input) return null;
  try {
    if (tool === 'chat') return send(res, 200, await chatAboutReport(report, input.messages));
    if (tool === 'ideas') {
      const result = await generateIdeas(report, { topic: input.topic, count: Number(input.count) || 6 });
      appendToReport(id, 'creations', { type: 'ideas', createdAt: new Date().toISOString(), topic: String(input.topic ?? '').slice(0, 300), ideas: result.ideas });
      return send(res, 200, result);
    }
    if (tool === 'script') {
      const result = await writeScript(report, input.idea);
      appendToReport(id, 'creations', { type: 'script', createdAt: new Date().toISOString(), script: result.script });
      return send(res, 200, result);
    }
    if (tool === 'pitch') {
      const result = await writeBrandPitch(report, input);
      appendToReport(id, 'creations', { type: 'pitch', createdAt: new Date().toISOString(), brand: String(input.brand ?? '').slice(0, 120), pitch: result.pitch });
      return send(res, 200, result);
    }
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
  return send(res, 404, { error: 'Unknown tool.' });
}

/** Instagram's own "similar accounts" for a profile, to suggest competitors or similar creators. */
async function suggestAccounts(res, handleInput) {
  if (!config.apifyToken) return send(res, 400, { error: 'Suggestions need an Apify token.' });
  let handleName;
  try {
    handleName = parseHandle(handleInput);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
  try {
    const profile = await fetchSnapshot(handleName);
    return send(res, 200, { handle: profile.handle, category: profile.category, source: profile.suggestionSource ?? null, suggestions: profile.relatedProfiles ?? [] });
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
}

async function handle(req, res) {
  if (!isAllowedHost(req)) return send(res, 403, { error: 'Forbidden' });
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === '/healthz') return send(res, 200, { ok: true });
  if (req.method === 'POST' && !isSameOrigin(req)) return send(res, 403, { error: 'Forbidden' });

  if (loginRequired) {
    if (req.method === 'POST' && pathname === '/api/login') {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'JSON required.' });
      return login(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/logout') {
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': clearedCookie({ secure: isSecure(req) }) });
      return res.end(JSON.stringify({ ok: true }));
    }
    const signedIn = sessions.isValid(readCookie(req.headers.cookie, COOKIE_NAME));
    if (!signedIn && !PUBLIC_PATHS.has(pathname)) {
      if (pathname.startsWith('/api/')) return send(res, 401, { error: 'Please sign in again.' });
      res.writeHead(302, { ...HEADERS, Location: '/login' });
      return res.end();
    }
  }

  if (req.method === 'POST' && pathname === '/api/reel-checks/upload') return reelCheckUpload(req, res);
  const toolMatch = pathname.match(/^\/api\/reports\/([0-9a-f-]{36})\/(chat|ideas|script|pitch)$/);
  if (req.method === 'POST' && (toolMatch || pathname === '/api/reel-checks/link')) {
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'JSON required.' });
    return toolMatch ? reportTool(req, res, toolMatch[1], toolMatch[2]) : reelCheckLink(req, res);
  }

  const inputsMatch = pathname.match(/^\/api\/reports\/([0-9a-f-]{36})\/inputs$/);
  if (req.method === 'POST' && inputsMatch) {
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'JSON required.' });
    return updateInputs(req, res, inputsMatch[1]);
  }

  if (req.method === 'POST' && (pathname === '/api/audit' || pathname === '/api/keys')) {
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'JSON required.' });
    return pathname === '/api/audit' ? createAudit(req, res) : updateKeys(req, res);
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  if (pathname === '/api/status') {
    return send(res, 200, { apify: Boolean(config.apifyToken), anthropic: config.hasAnthropicKey, model: config.model, hosted: config.hosted, loginRequired });
  }
  if (pathname === '/api/reports') return send(res, 200, listReports());
  if (pathname === '/api/reel-checks') return send(res, 200, listReelChecks());
  if (pathname === '/api/suggest') return suggestAccounts(res, new URL(req.url, 'http://local').searchParams.get('handle'));
  const checkMatch = pathname.match(/^\/api\/reel-checks\/([0-9a-f-]{36})$/);
  if (checkMatch) {
    const check = loadReelCheck(checkMatch[1]);
    return check ? send(res, 200, check) : send(res, 404, { error: 'Reel check not found.' });
  }
  const kitMatch = pathname.match(/^\/media-kit\/([0-9a-f-]{36})$/);
  if (kitMatch) {
    const report = loadReport(kitMatch[1]);
    return report ? send(res, 200, renderMediaKit(report), 'text/html; charset=utf-8') : send(res, 404, { error: 'Report not found.' });
  }

  let match = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (match) {
    const job = jobs.get(match[1]);
    return job ? send(res, 200, job) : send(res, 404, { error: 'Job not found.' });
  }
  match = pathname.match(/^\/api\/reports\/([0-9a-f-]{36})$/);
  if (match) {
    const report = loadReport(match[1]);
    return report ? send(res, 200, report) : send(res, 404, { error: 'Report not found.' });
  }
  match = pathname.match(/^\/thumbs\/([\w-]+)\.(jpg|png|webp)$/);
  if (match) {
    const file = path.join(THUMBS_DIR, `${match[1]}.${match[2]}`);
    if (!existsSync(file)) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { ...HEADERS, 'Content-Type': IMAGE_TYPES[match[2]] });
    return res.end(readFileSync(file));
  }
  const asset = STATIC_FILES[pathname];
  if (asset) return send(res, 200, readFileSync(path.join(config.publicDir, asset[0])), asset[1]);
  return send(res, 404, { error: 'Not found.' });
}

/** Keeps follower tracking going while the app is open. npm run snapshot covers the days it isn't. */
async function takeDueSnapshots() {
  if (!config.apifyToken) return;
  const tracker = openTracker();
  try {
    for (const handleName of tracker.handles()) {
      const last = tracker.lastTaken(handleName);
      if (last && Date.now() - new Date(last).getTime() < SNAPSHOT_AGE_MS) continue;
      try {
        tracker.record(await fetchSnapshot(handleName));
      } catch (error) {
        console.error(`Snapshot failed for @${handleName}: ${error.message}`);
      }
    }
  } finally {
    tracker.close();
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
  });
});

server.listen(config.port, config.listenHost, () => {
  console.log(config.hosted ? `Insta Audit is running on port ${config.port} (hosted, password required)` : `Insta Audit is running at http://localhost:${config.port}`);
  console.log(`Real accounts: ${config.apifyToken ? 'on' : 'off (no APIFY_TOKEN)'}  |  AI analysis: ${config.hasAnthropicKey ? 'on' : 'off (no ANTHROPIC_API_KEY)'}`);
});

setInterval(() => takeDueSnapshots().catch(console.error), SNAPSHOT_CHECK_MS).unref();
takeDueSnapshots().catch(console.error);
