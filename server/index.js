// VaultLedger API — zero npm dependencies (Node 20+ built-ins only).
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
import {analyze, AppError} from './analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {process.loadEnvFile?.(path.join(__dirname, '.env'))} catch {}
const PORT = +process.env.PORT || 4000;
const MAX_MB = +process.env.MAX_UPLOAD_MB || 10;
const MAX_ROWS = +process.env.MAX_ROWS || 200000;
const SECRET = process.env.SESSION_SECRET || 'vaultledger-demo-secret';
// DEMO ONLY: fixed demonstration password requested for this project. Not production authentication.
const DEMO_PASSWORD = 'Vault1027';
const CLIENT = path.join(__dirname, '..', 'client');
const STORE = path.join(os.tmpdir(), 'vaultledger-analyses');
fs.mkdirSync(STORE, {recursive: true});
for (const f of fs.readdirSync(STORE)) { // drop stale analyses (>24h)
  try {const p = path.join(STORE, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.unlinkSync(p)} catch {}
}

const sha = x => crypto.createHash('sha256').update(x).digest();
const sign = p => {const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url')};
function verify(t) {
  const [b, sig] = String(t || '').split('.'); if (!b || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null} catch {return null}
}
const owner = u => sha(u.email + '|' + u.username).toString('hex').slice(0, 16);
const send = (res, status, obj) => {const b = JSON.stringify(obj); res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(b), 'x-content-type-options': 'nosniff', 'cache-control': 'no-store'}); res.end(b)};
const readBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', c => {n += c.length; if (n > limit) {reject(new AppError(413, `File is larger than the ${MAX_MB} MB limit.`)); req.pause(); return} chunks.push(c)});
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
function parseMultipart(buf, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || ''); if (!m) return null;
  const b = Buffer.from('--' + (m[1] || m[2]));
  let start = buf.indexOf(b);
  while (start >= 0) {
    const next = buf.indexOf(b, start + b.length); if (next < 0) break;
    const part = buf.subarray(start + b.length + 2, next - 2), hEnd = part.indexOf('\r\n\r\n');
    if (hEnd > 0) {
      const cd = /name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(part.subarray(0, hEnd).toString('utf8'));
      if (cd && cd[2] !== undefined) return {field: cd[1], filename: cd[2], data: part.subarray(hEnd + 4)};
    }
    start = next;
  }
  return null;
}

const jobs = new Map();
const routes = [];
const route = (method, re, fn, needAuth = false) => routes.push({method, re, fn, needAuth});

route('GET', /^\/api\/health$/, (q, s) => send(s, 200, {ok: true}));
route('GET', /^\/api\/config$/, (q, s) => send(s, 200, {maxUploadMb: MAX_MB, maxRows: MAX_ROWS}));

route('POST', /^\/api\/login$/, async (q, s) => {
  let body = {}; try {body = JSON.parse((await readBody(q, 16384)).toString() || '{}')} catch {return send(s, 400, {error: 'Invalid request.'})}
  const {username = '', email = '', password = ''} = body, errors = {};
  if (typeof username !== 'string' || username.trim().length < 2) errors.username = 'Enter a username (at least 2 characters).';
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (typeof password !== 'string' || !password) errors.password = 'Enter the password.';
  if (Object.keys(errors).length) return send(s, 400, {error: 'Please fix the highlighted fields.', errors});
  if (!crypto.timingSafeEqual(sha(password), sha(DEMO_PASSWORD))) return send(s, 401, {error: 'Incorrect password. Try again.', errors: {password: 'Incorrect password.'}});
  const user = {username: username.trim().slice(0, 40), email: email.trim().toLowerCase()};
  send(s, 200, {token: sign({...user, exp: Date.now() + 8 * 36e5}), user});
});

route('POST', /^\/api\/upload$/, async (q, s) => {
  let raw; try {raw = await readBody(q, MAX_MB * 1024 * 1024 + 4096)} catch (e) {return send(s, e.status || 400, {error: e.message})}
  const f = parseMultipart(raw, q.headers['content-type']);
  if (!f) return send(s, 400, {error: 'No file received. Attach a .csv file.'});
  if (!/\.csv$/i.test(f.filename)) return send(s, 415, {error: 'Only .csv files are supported.'});
  if (!f.data.length) return send(s, 422, {error: 'The file is empty.'});
  if (f.data.length > MAX_MB * 1024 * 1024) return send(s, 413, {error: `File is larger than the ${MAX_MB} MB limit.`});
  const id = crypto.randomUUID(), job = {id, owner: owner(q.user), status: 'running', stage: 'Reading file', progress: 8};
  jobs.set(id, job);
  const name = path.basename(f.filename).slice(0, 120).replace(/[\u0000-\u001f]/g, '');
  (async () => {
    try {
      const result = await analyze(f.data, name, (stage, progress) => Object.assign(job, {stage, progress}), {maxRows: MAX_ROWS});
      result.id = crypto.randomUUID(); result.owner = job.owner;
      fs.writeFileSync(path.join(STORE, result.id + '.json'), JSON.stringify(result)); // only the analysis is kept, never the upload
      Object.assign(job, {status: 'done', stage: 'Done', progress: 100, analysisId: result.id});
    } catch (e) {
      if (!(e instanceof AppError)) console.error(e);
      Object.assign(job, {status: 'error', error: e instanceof AppError ? e.message : 'Could not analyze this file: ' + e.message});
    }
    setTimeout(() => jobs.delete(id), 10 * 60 * 1000).unref();
  })();
  send(s, 202, {jobId: id});
}, true);

route('GET', /^\/api\/jobs\/([\w-]+)$/, (q, s, m) => {
  const j = jobs.get(m[1]);
  if (!j || j.owner !== owner(q.user)) return send(s, 404, {error: 'Job not found or expired.'});
  const {id, status, stage, progress, analysisId, error} = j; send(s, 200, {id, status, stage, progress, analysisId, error});
}, true);

route('GET', /^\/api\/analyses\/([0-9a-f-]{36})$/, (q, s, m) => {
  const p = path.join(STORE, m[1] + '.json');
  if (!fs.existsSync(p)) return send(s, 404, {error: 'This analysis has expired or the server restarted. Please upload the dataset again.'});
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (a.owner !== owner(q.user)) return send(s, 404, {error: 'Analysis not found.'});
  delete a.owner; send(s, 200, a);
}, true);

route('GET', /^\/api\/samples\/([\w.-]+)$/, (q, s, m) => {
  const f = {'ledger.csv': 'vaultledger_sample_ledger.csv', 'bank-statement.csv': 'bank_statement.csv'}[m[1]];
  const p = f && path.join(__dirname, 'sample-data', f);
  if (!p || !fs.existsSync(p)) return send(s, 404, {error: 'Sample not found. Run: npm run generate:csv'});
  s.writeHead(200, {'content-type': 'text/csv', 'content-disposition': `attachment; filename="${f}"`}); fs.createReadStream(p).pipe(s);
});

const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'};
function serveStatic(q, s) {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(CLIENT, p));
  if (!file.startsWith(CLIENT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(s, 404, {error: 'Not found'});
  s.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff'}); fs.createReadStream(file).pipe(s);
}

http.createServer(async (q, s) => {
  try {
    const url = new URL(q.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return q.method === 'GET' ? serveStatic(q, s) : send(s, 405, {error: 'Method not allowed'});
    for (const r of routes) {
      const m = r.method === q.method && r.re.exec(url.pathname); if (!m) continue;
      if (r.needAuth) {
        const u = verify((q.headers.authorization || '').replace(/^Bearer /, ''));
        if (!u) return send(s, 401, {error: 'Your session is missing or expired. Please log in again.'});
        q.user = u;
      }
      return await r.fn(q, s, m);
    }
    send(s, 404, {error: 'Not found'});
  } catch (e) {console.error(e); if (!s.headersSent) send(s, 500, {error: 'Unexpected server error.'})}
}).listen(PORT, () => console.log(`VaultLedger running at http://localhost:${PORT}`));
