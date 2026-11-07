import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fetchSnapshot } from './apify.js';
import { listReports, loadReport, openTracker, runDemoAudit, runLiveAudit, saveInputs, THUMBS_DIR } from './audit.js';
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
    .then((report) => {
      job.state = 'done';
      job.reportId = report.id;
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

  if (input.demo === true) {
    return send(res, 202, { jobId: startJob((progress) => runDemoAudit({ timezone, notes, brief }, progress)).id });
  }

  let a;
  let competitors;
  try {
    a = parseHandle(input.a);
    const entered = Array.isArray(input.competitors) ? input.competitors.filter((value) => String(value ?? '').trim()) : [];
    if (!entered.length) return send(res, 400, { error: 'Please enter at least one competitor.' });
    if (entered.length > MAX_COMPETITORS) return send(res, 400, { error: `Please enter up to ${MAX_COMPETITORS} competitors.` });
    competitors = entered.map(parseHandle);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
  if (new Set([a, ...competitors]).size !== competitors.length + 1) return send(res, 400, { error: 'Please enter different companies.' });
  if (!config.apifyToken) {
    return send(res, 400, { error: config.hosted ? 'No Apify token is set. Add APIFY_TOKEN in your hosting settings.' : 'No Apify token is set. Add it in Settings, or view the sample report.' });
  }
  return send(res, 202, { jobId: startJob((progress) => runLiveAudit({ a, competitors, notes, brief, timezone, skipAi: input.skipAi === true }, progress)).id });
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
