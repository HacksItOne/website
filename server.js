'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const { layout, body, formPage, PAGES, SITE, esc } = require('./views');
const { fetchCyberNews } = require('./news');

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE = (PROD ? '__Host-' : '') + 'sid';
const SESSION_MS = 2 * 60 * 60 * 1000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ---------- response helpers ----------
function send(res, status, html, type = 'text/html; charset=utf-8', cache = 'no-store') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(html);
}
const redirect = (res, to) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
function notFound(res) {
  send(res, 404, layout({ path: '/404', title: 'Page not found | Hacksitone', desc: 'Page not found.', noindex: true, body: '<section class="wrap"><h1>Page not found</h1><p class="lead">That page does not exist. Return <a href="/">home</a> or browse our <a href="/services">services</a>.</p></section>' }));
}

// ---------- database: Turso (libSQL), parameterized queries only ----------
// Production: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. Local dev falls back to a file (data.db).
const db = createClient({ url: process.env.TURSO_DATABASE_URL || 'file:data.db', authToken: process.env.TURSO_AUTH_TOKEN });
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] || null;
const many = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const run = (sql, args = []) => db.execute({ sql, args });
const qByEmail = (email) => one('SELECT * FROM users WHERE email = ?', [email]);
const qInsert = (name, email, hash, created) => run('INSERT INTO users(name,email,hash,created) VALUES(?,?,?,?)', [name, email, hash, created]);
const qFail = (fails, lockedUntil, id) => run('UPDATE users SET fails = ?, locked_until = ? WHERE id = ?', [fails, lockedUntil, id]);

// ---------- admin credentials (from environment variables, never hard-coded) ----------
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_NAME = process.env.ADMIN_NAME || 'admin';

// ---------- password hashing: scrypt, per-user salt, constant-time compare ----------
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
async function hashPw(pw) { const salt = crypto.randomBytes(16); return `s1$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`; }
async function verifyPw(pw, stored) {
  const [, s, k] = stored.split('$');
  const a = await scrypt(pw, Buffer.from(s, 'hex')), b = Buffer.from(k, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
let DUMMY; hashPw('dummy-password-for-timing').then((h) => (DUMMY = h)); // equalizes timing for unknown emails

// ---------- registration constants ----------
const REG = { path: '/register', heading: 'Create your account', action: '/register', cta: 'Create account', alt: 'Already registered? <a href="/login">Log in</a>.',
  fields: [['name', 'Full name', 'text', 'name', 'maxlength="60"'], ['email', 'Email address', 'email', 'email', 'maxlength="254"'],
    ['password', 'Password (12+ characters, mixed case, a number and a symbol)', 'password', 'new-password', "minlength='12' maxlength='128'"],
    ['confirm', 'Confirm password', 'password', 'new-password', "minlength='12' maxlength='128'"]] };
const LOGIN = { path: '/login', heading: 'Log in', action: '/login', cta: 'Log in', alt: 'New here? <a href="/register">Create an account</a>.',
  fields: [['email', 'Email address', 'email', 'email', 'maxlength="254"'], ['password', 'Password', 'password', 'current-password', 'maxlength="128"']] };

// ---------- auth handlers ----------
async function register(req, res, s, f) {
  const name = String(f.name || '').trim().replace(/\s+/g, ' '), email = String(f.email || '').trim().toLowerCase(), pw = String(f.password || ''), pw2 = String(f.confirm || '');
  const show = (error) => send(res, 400, formPage({ ...REG, csrf: s.csrf, error, fields: REG.fields.map((x) => (x[0] === 'name' ? [...x.slice(0, 5), name] : x[0] === 'email' ? [...x.slice(0, 5), email] : x)) }));
  if (!NAME_RE.test(name)) return show('Enter your name using 2 to 60 letters.');
  if (email.length > 254 || !EMAIL_RE.test(email)) return show('Enter a valid email address.');
  const prob = passwordProblem(pw, email); if (prob) return show(prob);
  if (!safeEq(pw, pw2)) return show('Passwords do not match.');
  if (!(await qByEmail(email))) { try { await qInsert(name, email, await hashPw(pw), Date.now()); } catch {} } else await hashPw(pw); // same response and similar timing either way: no account enumeration
  s.flash = 'Registration received. You can now log in.'; redirect(res, '/login');
}
async function login(req, res, s, f) {
  const email = String(f.email || '').trim().toLowerCase().slice(0, 254), pw = String(f.password || '').slice(0, 128);
  const bad = (code, msg) => send(res, code, formPage({ ...LOGIN, csrf: s.csrf, error: msg }));
  const u = await qByEmail(email); const now = Date.now();
  const ok = await verifyPw(pw, u ? u.hash : DUMMY);
  if (u && u.locked_until > now) return bad(429, 'Too many failed attempts. Try again in 15 minutes.');
  if (!u || !ok) {
    if (u) { const n = u.fails + 1; await qFail(n >= 5 ? 0 : n, n >= 5 ? now + 15 * 60000 : 0, u.id); }
    return bad(401, 'Email or password is incorrect.');
  }
  await qFail(0, 0, u.id); rotate(req, res, s, u); redirect(res, '/dashboard');
}
async function adminLogin(req, res, s, f) {
  const email = String(f.email || '').trim().toLowerCase().slice(0, 254), pw = String(f.password || '').slice(0, 128);
  const bad = (code, msg) => send(res, code, formPage({ path: '/admin/login', heading: 'Admin Login', action: '/admin/login', cta: 'Sign in', alt: 'Not admin? <a href="/">Go to home</a>.', fields: [['email', 'Email address', 'email', 'email', 'maxlength="254"'], ['password', 'Password', 'password', 'current-password', 'maxlength="128"']], csrf: s.csrf, error: msg }));
  const u = await qByEmail(email);
  if (!u || !(await verifyPw(pw, u ? u.hash : DUMMY))) return bad(401, 'Email or password is incorrect.');
  if (u.email !== ADMIN_EMAIL) return bad(403, 'Access denied. Invalid admin credentials.');
  s.isAdmin = true; s.name = ADMIN_NAME; redirect(res, '/admin');
}
async function adminJobs(req, res, s) {
  if (!s.isAdmin) return redirect(res, '/admin/login');
  const jobs = await qJobGetAll();
  return send(res, 200, layout({ path: '/admin', user: s.name, csrf: s.csrf, noindex: true, title: 'Admin Panel | Hacksitone', desc: 'Admin panel for managing job postings and site settings.', body: `<section class="wrap"><h1>Admin Panel</h1><p>Manage job postings for the careers page.</p><div class="jobs-list">${jobs.map(job => `<div class="job-card"><h2>${esc(job.title)}</h2><p>${esc(job.description.substring(0, 80))}...</p><div><a class="btn sm" href="/admin/jobs/edit/${job.slug}">Edit</a> <a class="btn sm ghost" href="/admin/jobs/delete/${job.slug}" onclick="return confirm('Delete this job?')">Delete</a></div></div>`).join('')}</div><form method="post" action="/admin/jobs/create"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><h2>Create New Job Posting</h2><label>Title <input type="text" name="title" required></label><label>Slug <input type="text" name="slug" required></label><label>Description <textarea name="description" rows="3" required></textarea></label><label>Requirements <textarea name="requirements" rows="3"></textarea></label><label>Location <input type="text" name="location"></label><label>Type <input type="text" name="type" value="Full-time"></label><button class="btn" type="submit">Create Job</button></form></section>` }));
}
async function adminJobUpdate(req, res, s, f) {
  if (!s.isAdmin) return redirect(res, '/admin/login');
  const originalSlug = String(f.originalSlug || '').trim().toLowerCase();
  const title = String(f.title || '').trim().slice(0, 160);
  const description = String(f.description || '').trim().slice(0, 10000);
  const requirements = String(f.requirements || '').trim().slice(0, 10000);
  const location = String(f.location || '').trim().slice(0, 200);
  const type = String(f.type || 'Full-time').trim().slice(0, 80);
  const status = String(f.status || 'active');
  if (!originalSlug || !title || !description || !['active', 'inactive', 'closed'].includes(status)) {
    return send(res, 400, 'Invalid job details. Please go back and check the required fields and status.', 'text/plain; charset=utf-8');
  }
  const existing = await qJobGet(originalSlug);
  if (!existing) return send(res, 404, 'Job not found.', 'text/plain; charset=utf-8');
  await qJobUpdate(title, description, requirements, location, type, status, originalSlug);
  return redirect(res, '/admin');
}

async function adminJobCreate(req, res, s, f) {
  if (!s.isAdmin) return redirect(res, '/admin/login');
  const title = String(f.title || '').trim();
  const slug = String(f.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const description = String(f.description || '').trim();
  const requirements = String(f.requirements || '').trim();
  const location = String(f.location || '').trim();
  const type = String(f.type || 'Full-time').trim();
  if (!title || !slug || !description) {
    const jobs = await qJobGetAll();
    return send(res, 400, layout({ path: '/admin', user: s.name, csrf: s.csrf, noindex: true, title: 'Admin Panel | Hacksitone', desc: 'Admin panel for managing job postings and site settings.', body: `<section class="wrap"><h1>Admin Panel</h1><p class="msg err">Title, slug, and description are required.</p><div class="jobs-list">${jobs.map(job => `<div class="job-card"><h2>${esc(job.title)}</h2><p>${esc(job.description.substring(0, 80))}...</p><div><a class="btn sm" href="/admin/jobs/edit/${job.slug}">Edit</a> <a class="btn sm ghost" href="/admin/jobs/delete/${job.slug}" onclick="return confirm('Delete this job?')">Delete</a></div></div>`).join('')}</div><form method="post" action="/admin/jobs/create"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><h2>Create New Job Posting</h2><label>Title <input type="text" name="title" required></label><label>Slug <input type="text" name="slug" required></label><label>Description <textarea name="description" rows="3" required></textarea></label><label>Requirements <textarea name="requirements" rows="3"></textarea></label><label>Location <input type="text" name="location"></label><label>Type <input type="text" name="type" value="Full-time"></label><button class="btn" type="submit">Create Job</button></form></section>` }));
  }
  try {
    await qJobInsert(title, slug, description, requirements, location, type, 'active', Date.now());
    redirect(res, '/admin');
  } catch (e) {
    const jobs = await qJobGetAll();
    return send(res, 400, layout({ path: '/admin', user: s.name, csrf: s.csrf, noindex: true, title: 'Admin Panel | Hacksitone', desc: 'Admin panel for managing job postings and site settings.', body: `<section class="wrap"><h1>Admin Panel</h1><p class="msg err">Slug already exists or database error.</p><div class="jobs-list">${jobs.map(job => `<div class="job-card"><h2>${esc(job.title)}</h2><p>${esc(job.description.substring(0, 80))}...</p><div><a class="btn sm" href="/admin/jobs/edit/${job.slug}">Edit</a> <a class="btn sm ghost" href="/admin/jobs/delete/${job.slug}" onclick="return confirm('Delete this job?')">Delete</a></div></div>`).join('')}</div><form method="post" action="/admin/jobs/create"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><h2>Create New Job Posting</h2><label>Title <input type="text" name="title" required></label><label>Slug <input type="text" name="slug" required></label><label>Description <textarea name="description" rows="3" required></textarea></label><label>Requirements <textarea name="requirements" rows="3"></textarea></label><label>Location <input type="text" name="location"></label><label>Type <input type="text" name="type" value="Full-time"></label><button class="btn" type="submit">Create Job</button></form></section>` }));
  }
}

// ---------- sessions & CSRF ----------
const sessions = new Map();
const rnd = (n) => crypto.randomBytes(n).toString('hex');
function readCookie(req) { const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '=')); return m ? m.slice(COOKIE.length + 1) : ''; }
function setCookie(res, tok) { res.setHeader('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${PROD ? '; Secure' : ''}`); }
function getSession(req, res, create) {
  const tok = readCookie(req); let s = /^[a-f0-9]{64}$/.test(tok) ? sessions.get(tok) : null;
  if (s && s.exp < Date.now()) { sessions.delete(tok); s = null; }
  if (s) { s.exp = Date.now() + SESSION_MS; return s; }
  if (!create || sessions.size > 20000) return null;
  const t = rnd(32); s = { tok: t, uid: null, name: null, csrf: rnd(24), exp: Date.now() + SESSION_MS };
  sessions.set(t, s); setCookie(res, t); return s;
}
function rotate(req, res, s, user) {
  sessions.delete(s.tok); const t = rnd(32);
  const n = { tok: t, uid: user.id, name: user.name, csrf: rnd(24), exp: Date.now() + SESSION_MS };
  sessions.set(t, n); setCookie(res, t); return n;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (v.exp < n) sessions.delete(k); }, 60000).unref();
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- rate limiting ----------
const buckets = new Map();
function hit(key, max, windowMs) {
  const n = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < n) { b = { c: 0, reset: n + windowMs }; buckets.set(key, b); }
  return ++b.c > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of buckets) if (v.reset < n) buckets.delete(k); }, 60000).unref();
const clientIp = (req) => (TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '') || req.socket.remoteAddress;
const sameOrigin = (req) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };

// ---------- security headers ----------
function secHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
}

// ---------- form parser ----------
function readForm(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/x-www-form-urlencoded/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { code: 415 }));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 10240) { reject(Object.assign(new Error('big'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const o = {}; for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) if (!(k in o)) o[k] = v; resolve(o); });
    req.on('error', reject);
  });
}

// ---------- validation ----------
const NAME_RE = /^[\p{L}][\p{L} .'-]{1,59}$/u;
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,255}\.[A-Za-z]{2,}$/;
function passwordProblem(pw, email) {
  if (pw.length < 12 || pw.length > 128) return 'Use a password between 12 and 128 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return 'Include upper and lower case letters, a number and a symbol.';
  if (pw.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length > 3) return 'Your password must not contain your email name.';
  if (/^(password|12345678|qwerty)/i.test(pw)) return 'That password is too common. Choose another.';
  return '';
}

// ---------- render helper ----------
const render = (req, path_, s) => layout({ path: path_, body: body[path_](), user: s && s.name, csrf: s && s.csrf });

// ---------- job posting model (parameterized queries) ----------
const qJobInsert = (t, slug, d, r, l, type, status, created) => run('INSERT INTO jobs(title, slug, description, requirements, location, type, status, created) VALUES(?,?,?,?,?,?,?,?)', [t, slug, d, r, l, type, status, created]);
const qJobGet = (slug) => one('SELECT * FROM jobs WHERE slug = ?', [slug]);
const qJobGetAll = () => many('SELECT * FROM jobs ORDER BY created DESC');
const qJobUpdate = (t, d, r, l, type, status, slug) => run('UPDATE jobs SET title = ?, description = ?, requirements = ?, location = ?, type = ?, status = ? WHERE slug = ?', [t, d, r, l, type, status, slug]);
const qJobDelete = (slug) => run('DELETE FROM jobs WHERE slug = ?', [slug]);

// ---------- schema + admin bootstrap (runs once before the server starts listening) ----------
async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS jobs(
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
      requirements TEXT, location TEXT, type TEXT, status TEXT NOT NULL DEFAULT 'active', created INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS applications(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
      coverLetter TEXT, resumeUrl TEXT, jobSlug TEXT NOT NULL, created INTEGER NOT NULL)`,
  ], 'write');
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set: admin login is disabled.'); return; }
  if (!(await qByEmail(ADMIN_EMAIL))) {
    await qInsert(ADMIN_NAME, ADMIN_EMAIL, await hashPw(ADMIN_PASSWORD), Date.now());
    console.log('Admin user created');
  }
}

// ---------- AI help desk ----------
const AI_KEYWORDS = {
  phishing: 'Phishing attacks are fraudulent attempts to obtain sensitive information by disguising as trustworthy entities. Our detection tooling analyzes emails and links for suspicious indicators.',
  detection: 'Managed detection and response provides round-the-clock monitoring, triage and containment of threats before they spread across your network.',
  penetration: 'Penetration testing involves manual, scoped attacks on web apps, APIs, networks and mobile apps to find weaknesses before attackers exploit them.',
  response: 'Incident response includes on-call responders for containment, forensics and recovery, plus a post-incident plan to prevent repeats.',
  encryption: 'Crypt_dir Pro uses three encryption algorithms to securely encrypt data on hard drives with a GUI for safe decryption with a secret key.',
  cloud: 'Cloud security hardening for AWS, Azure and GCP includes identity policies, CI/CD pipeline security and account hardening.',
  compliance: 'Compliance support for ISO 27001, SOC 2 and CERT-In includes gap assessments and evidence preparation.',
  apply: 'To apply for careers, create an account and your profile will be reviewed by our hiring team. Open roles include Security Engineer, Penetration Tester, SOC Analyst and Research Intern.',
};

// ---------- static files (whitelisted directory, no traversal) ----------
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  const ext = path.extname(file).toLowerCase();
  if (!file.startsWith(PUBLIC + path.sep) || !MIME[ext]) return notFound(res);
  fs.readFile(file, (e, data) => (e ? notFound(res) : send(res, 200, req.method === 'HEAD' ? '' : data, MIME[ext], ext === '.css' ? 'no-cache' : 'public, max-age=86400')));
}

// ---------- router ----------
async function adminJobDelete(req, res, s, f) {
  if (!s.isAdmin) return redirect(res, '/admin/login');
  const slug = String(f.slug || '').trim().toLowerCase();
  if (slug) await qJobDelete(slug);
  return redirect(res, '/admin');
}

async function submitApplication(req, res, s, f) {
  const jobSlug = String(f.jobSlug || '').trim().toLowerCase();
  const name = String(f.name || '').trim().slice(0, 100);
  const email = String(f.email || '').trim().toLowerCase().slice(0, 254);
  const phone = String(f.phone || '').trim().slice(0, 30);
  const resumeUrl = String(f.resumeUrl || '').trim().slice(0, 500);
  const coverLetter = String(f.coverLetter || '').trim().slice(0, 5000);
  const job = await qJobGet(jobSlug);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const urlOk = !resumeUrl || /^https?:\/\/[^\s]+$/i.test(resumeUrl);
  if (!job || job.status !== 'active' || name.length < 2 || !emailOk || !urlOk || coverLetter.length < 10) {
    return send(res, 400, 'Please go back and check your details: name, a valid email, a valid http(s) resume link, and a short cover letter.', 'text/plain; charset=utf-8');
  }
  await run('INSERT INTO applications(name,email,phone,coverLetter,resumeUrl,jobSlug,created) VALUES(?,?,?,?,?,?,?)', [name, email, phone, coverLetter, resumeUrl, jobSlug, Date.now()]);
  return send(res, 200, layout({ path: '/application', user: s.name, csrf: s.csrf, noindex: true, title: 'Application received | Hacksitone', desc: 'Application received.',
    body: `<section class="wrap narrow"><h1>Application received</h1><p class="msg ok">Thank you, ${esc(name)}. We have received your application for ${esc(job.title)}.</p><p><a class="btn ghost" href="/careers">Back to Careers</a></p></section>` }));
}

const server = http.createServer(async (req, res) => {
  secHeaders(res);
  try {
    const ip = clientIp(req);
    if (hit('g:' + ip, 300, 60000)) return send(res, 429, 'Too many requests. Slow down.', 'text/plain; charset=utf-8');
    if (req.url.length > 2048) return send(res, 414, 'URI too long', 'text/plain');
    const pathname = new URL(req.url, 'http://x').pathname;

    if (req.method === 'POST') {
      if (!['/login', '/register', '/logout', '/admin/login', '/admin/jobs', '/admin/jobs/create', '/admin/jobs/update', '/application'].includes(pathname)) return send(res, 405, 'Method not allowed', 'text/plain');
      if (!sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain');
      if (pathname !== '/logout' && hit('a:' + ip, 10, 15 * 60000)) return send(res, 429, 'Too many attempts. Try again in 15 minutes.', 'text/plain; charset=utf-8');
      const f = await readForm(req); const s = getSession(req, res, true);
      if (!s) return send(res, 503, 'Busy. Try again shortly.', 'text/plain');
      if (!safeEq(f._csrf || '', s.csrf)) return send(res, 403, 'Invalid or expired form. Go back, reload the page and try again.', 'text/plain; charset=utf-8');
      if (pathname === '/register') return await register(req, res, s, f);
      if (pathname === '/login') return await login(req, res, s, f);
      if (pathname === '/admin/login') return await adminLogin(req, res, s, f);
      if (pathname === '/admin/jobs') return await adminJobs(req, res, s);
      if (pathname === '/admin/jobs/create') return await adminJobCreate(req, res, s, f);
      if (pathname === '/admin/jobs/update') return await adminJobUpdate(req, res, s, f);
      if (pathname === '/admin/jobs/delete') return await adminJobDelete(req, res, s, f);
      if (pathname === '/application') return await submitApplication(req, res, s, f);
      sessions.delete(s.tok); res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${PROD ? '; Secure' : ''}`);
      return redirect(res, '/');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

    if (pathname !== '/careers' && body[pathname]) return send(res, 200, render(req, pathname, getSession(req, res, false)));
    if (pathname === '/login' || pathname === '/register') {
      const s = getSession(req, res, true); if (!s) return send(res, 503, 'Busy', 'text/plain');
      if (s.uid) return redirect(res, '/dashboard');
      const info = s.flash; delete s.flash;
      const page = pathname === '/login' ? LOGIN : REG;
      return send(res, 200, formPage({ ...page, csrf: s.csrf, info }));
    }
    if (pathname === '/dashboard') {
      const s = getSession(req, res, false); if (!s || !s.uid) return redirect(res, '/login');
      const row = await one('SELECT email, created FROM users WHERE id = ?', [s.uid]);
      return send(res, 200, layout({ path: '/dashboard', user: s.name, csrf: s.csrf, noindex: true, title: 'Dashboard | Hacksitone', desc: 'Your Hacksitone account.',
        body: `<section class="wrap"><h1>Welcome, ${require('./views').esc(s.name)}</h1><p class="lead">You are signed in as ${require('./views').esc(row.email)}. Member since ${new Date(row.created).toLocaleDateString('en-GB')}.</p><p>We will email you when Hacksitone products open for early access.</p></section>` }));
    }
    if (pathname.startsWith('/job/')) {
      let slug = '';
      try { slug = decodeURIComponent(pathname.slice(5)).toLowerCase(); } catch { return notFound(res); }
      const job = await qJobGet(slug);
      const s = getSession(req, res, false);
      if (!job || (job.status !== 'active' && !(s && s.isAdmin))) return notFound(res);
      return send(res, 200, layout({ path: '/job', user: s && s.name, csrf: s && s.csrf, title: `${job.title} | Hacksitone Careers`, desc: job.description.substring(0, 150),
        body: `<section class="wrap"><h1>${esc(job.title)}</h1><p class="lead">${esc(job.description)}</p><dl class="rules"><div><dt>Location</dt><dd>${esc(job.location || 'Not specified')}</dd><dt>Type</dt><dd>${esc(job.type || 'Full-time')}</dd>${job.requirements ? `<dt>Requirements</dt><dd style="white-space:pre-wrap">${esc(job.requirements)}</dd>` : ''}</div></dl><p>${job.status === 'active' ? `<a class="btn" href="/application?job=${encodeURIComponent(job.slug)}">Apply Now</a> ` : ''}<a class="btn ghost" href="/careers">Back to Careers</a></p></section>` }));
    }
    if (pathname === '/application') {
      const slug = String(new URL(req.url, 'http://x').searchParams.get('job') || '').toLowerCase();
      const job = await qJobGet(slug);
      if (!job || job.status !== 'active') return notFound(res);
      const s = getSession(req, res, true); if (!s) return send(res, 503, 'Busy', 'text/plain');
      return send(res, 200, layout({ path: '/application', user: s.name, csrf: s.csrf, noindex: true, title: `Apply: ${job.title} | Hacksitone`, desc: 'Apply for a role at Hacksitone.',
        body: `<section class="wrap narrow"><h1>Apply: ${esc(job.title)}</h1><form method="post" action="/application"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><input type="hidden" name="jobSlug" value="${esc(job.slug)}"><label for="name">Full name</label><input id="name" name="name" maxlength="100" required><label for="email">Email</label><input id="email" name="email" type="email" maxlength="254" required><label for="phone">Phone (optional)</label><input id="phone" name="phone" maxlength="30"><label for="resumeUrl">Resume link (Google Drive, LinkedIn, etc.)</label><input id="resumeUrl" name="resumeUrl" type="url" maxlength="500"><label for="coverLetter">Why do you want to join us?</label><textarea id="coverLetter" name="coverLetter" rows="6" maxlength="5000" required></textarea><button class="btn" type="submit">Submit application</button></form></section>` }));
    }
    if (pathname === '/careers') {
      const jobs = (await qJobGetAll()).filter((j) => j.status === 'active');
      const s = getSession(req, res, false);
      return send(res, 200, layout({ path: '/careers', user: s && s.name, csrf: s && s.csrf, title: 'Careers | Join Hacksitone', desc: 'Build defensive security at Hacksitone. See open roles in security engineering, research and operations.',
        body: `<section class="wrap"><h1>Careers at Hacksitone</h1><p class="lead">Help us secure what matters. We hire people who like understanding how things break and building them so they don't.</p><dl class="rules">${jobs.map((job) => `<div><dt><a href="/job/${encodeURIComponent(job.slug)}">${esc(job.title)}</a></dt><dd>${esc(job.description.substring(0, 200))}${job.description.length > 200 ? '…' : ''}</dd><dt>Location</dt><dd>${esc(job.location || 'Not specified')}</dd><dt>Type</dt><dd>${esc(job.type || 'Full-time')}</dd></div>`).join('')}</dl>${jobs.length === 0 ? '<p><em>No open positions right now. Please check back soon.</em></p>' : ''}</section>` }));
    }
    if (pathname === '/news') {
      const s = getSession(req, res, false);
      const articles = await fetchCyberNews();
      return send(res, 200, layout({ path: '/news', user: s && s.name, csrf: s && s.csrf, noindex: true, title: 'Cybersecurity News | Hacksitone', desc: 'Latest cybersecurity news, threat intelligence, and security research from across the industry.', body: `<section class="wrap"><h1>Cybersecurity News</h1><p class="lead">Curated security news, vulnerability disclosures, and threat intelligence from trusted sources.</p><div class="news-grid">${articles.map(a => `<article class="news-card" data-reveal><h2><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></h2><p class="news-meta">${esc(a.source)} • ${new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p><p class="news-excerpt">${esc(a.excerpt)}</p><a class="news-link" href="${esc(a.url)}" target="_blank" rel="noopener">Read more →</a></article>`).join('')}</div>${articles.length === 0 ? '<p class="lead">Unable to fetch news at this time. Please try again later.</p>' : ''}<p style="margin-top:2rem"><a class="btn ghost" href="/">Back to Home</a></p></section>` }));
    }
    if (pathname === '/admin/applications') {
      const s = getSession(req, res, false); if (!s || !s.isAdmin) return redirect(res, '/admin/login');
      const apps = await many('SELECT * FROM applications ORDER BY created DESC LIMIT 200');
      return send(res, 200, layout({ path: '/admin', user: s.name, csrf: s.csrf, noindex: true, title: 'Applications | Hacksitone', desc: 'Job applications.',
        body: `<section class="wrap"><h1>Applications</h1><p><a class="btn ghost sm" href="/admin">Back to Admin</a></p>${apps.length === 0 ? '<p><em>No applications yet.</em></p>' : ''}<dl class="rules">${apps.map((a) => `<div><dt>${esc(a.name)} — ${esc(a.jobSlug)}</dt><dd>${esc(a.email)}${a.phone ? ' · ' + esc(a.phone) : ''} · ${new Date(a.created).toLocaleString('en-GB')}</dd>${a.resumeUrl ? `<dd><a href="${esc(a.resumeUrl)}" target="_blank" rel="noopener noreferrer">Resume link</a></dd>` : ''}<dd style="white-space:pre-wrap">${esc(a.coverLetter || '')}</dd></div>`).join('')}</dl></section>` }));
    }
    if (pathname === '/admin') {
      const s = getSession(req, res, false); if (!s || !s.isAdmin) return redirect(res, '/admin/login');
      const jobs = await qJobGetAll();
      return send(res, 200, layout({ path: '/admin', user: s.name, csrf: s.csrf, noindex: true, title: 'Admin Panel | Hacksitone', desc: 'Admin panel for managing job postings and site settings.',
        body: `<section class="wrap"><h1>Admin Panel</h1><p>Manage job postings for the careers page. <a href="/admin/applications">View applications</a></p><div class="jobs-list">${jobs.map((job) => `<div class="job-card"><h2>${esc(job.title)} <span class="tag">${esc(job.status)}</span></h2><p>${esc(job.description.substring(0, 80))}...</p><div><a class="btn sm" href="/admin/jobs/edit/${encodeURIComponent(job.slug)}">Edit</a> <form method="post" action="/admin/jobs/delete" data-confirm="Delete this job?" style="display:inline;margin:0"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><input type="hidden" name="slug" value="${esc(job.slug)}"><button class="btn sm ghost" type="submit">Delete</button></form></div></div>`).join('')}</div><form method="post" action="/admin/jobs/create"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><h2>Create New Job Posting</h2><label>Title <input type="text" name="title" required></label><label>Slug (letters, numbers, hyphens) <input type="text" name="slug" required></label><label>Description <textarea name="description" rows="3" required></textarea></label><label>Requirements <textarea name="requirements" rows="3"></textarea></label><label>Location <input type="text" name="location"></label><label>Type <input type="text" name="type" value="Full-time"></label><button class="btn" type="submit">Create Job</button></form></section>` }));
    }
    const editMatch = pathname.match(/^\/admin\/jobs\/edit\/([^/]+)$/);
    if (editMatch) {
      const s = getSession(req, res, false);
      if (!s || !s.isAdmin) return redirect(res, '/admin/login');
      const slug = decodeURIComponent(editMatch[1]).toLowerCase();
      const job = await qJobGet(slug);
      if (!job) return notFound(res);
      const bodyHtml = `<section class="wrap"><h1>Edit Job Posting</h1><form method="post" action="/admin/jobs/update"><input type="hidden" name="_csrf" value="${esc(s.csrf)}"><input type="hidden" name="originalSlug" value="${esc(job.slug)}"><label>Slug <input value="${esc(job.slug)}" disabled></label><label>Title <input type="text" name="title" maxlength="160" value="${esc(job.title)}" required></label><label>Description <textarea name="description" rows="5" maxlength="10000" required>${esc(job.description)}</textarea></label><label>Requirements <textarea name="requirements" rows="5" maxlength="10000">${esc(job.requirements || '')}</textarea></label><label>Location <input type="text" name="location" maxlength="200" value="${esc(job.location || '')}"></label><label>Type <input type="text" name="type" maxlength="80" value="${esc(job.type || 'Full-time')}"></label><label>Status <select name="status"><option value="active"${job.status === 'active' ? ' selected' : ''}>Active</option><option value="inactive"${job.status === 'inactive' ? ' selected' : ''}>Inactive</option><option value="closed"${job.status === 'closed' ? ' selected' : ''}>Closed</option></select></label><button class="btn" type="submit">Save Changes</button> <a class="btn ghost" href="/admin">Cancel</a></form></section>`;
      return send(res, 200, layout({ path: '/admin', user: s.name, csrf: s.csrf, noindex: true, title: 'Edit Job | Hacksitone', desc: 'Edit a job posting.', body: bodyHtml }));
    }
    if (pathname === '/admin/login') {
      const s = getSession(req, res, true); if (!s) return send(res, 503, 'Busy', 'text/plain');
      const info = s.flash; delete s.flash;
      return send(res, 200, formPage({ path: '/admin/login', heading: 'Admin Login', action: '/admin/login', cta: 'Sign in', alt: 'Not admin? <a href="/">Go to home</a>.', fields: [['email', 'Email address', 'email', 'email', 'maxlength="254"'], ['password', 'Password', 'password', 'current-password', 'maxlength="128"']], csrf: s.csrf }));
    }
    if (pathname === '/admin/logout') {
      sessions.delete(s.tok); res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${PROD ? '; Secure' : ''}`);
      return redirect(res, '/');
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (e.code === 413 || e.code === 415) return send(res, e.code, 'Request rejected', 'text/plain');
    console.error(e.message);
    if (!res.headersSent) send(res, 500, 'Something went wrong. Please try again.', 'text/plain; charset=utf-8');
  }
});
server.headersTimeout = 15000; server.requestTimeout = 20000; server.maxHeadersCount = 50;
initDb().then(() => server.listen(PORT, () => console.log(`Hacksitone running on http://localhost:${PORT}${PROD ? '' : ' (development: set NODE_ENV=production behind HTTPS)'}`)))
  .catch((e) => { console.error('Database startup failed:', e.message); process.exit(1); });
