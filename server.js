#!/usr/bin/env node
/* ============================================================
   Hospital Meter Manager — Cloud Sync Server
   Zero external dependencies (uses only Node.js built-ins).
   Storage: JSON files on disk (one file per "hospital group").

   Endpoints
   ---------
   GET  /                     -> human status page
   GET  /api/health           -> { ok, service, version, time }
   POST /api/sync             -> two-way sync (push + pull)
   GET  /api/pull?group=&since= -> pull-only

   Auth: if env SYNC_TOKEN is set, requests must send
         Authorization: Bearer <SYNC_TOKEN>
   Group: hospital code, taken from body.group, X-Group header,
          or the URL path /api/sync/<group>. Defaults to "default".

   Developed By Tech Arslan Software Solutions 03200199895
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SYNC_TOKEN = process.env.SYNC_TOKEN || '';
const COLLECTIONS = ['users', 'meters', 'readings', 'bills', 'devices'];
const VERSION = '1.0.0';
const BRAND = 'Software Developed By Tech Arslan Software Solutions 03200199895';

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- storage helpers ---------- */
function safeGroup(g) {
  return String(g || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}
function groupFile(g) { return path.join(DATA_DIR, safeGroup(g) + '.json'); }
function loadGroup(g) {
  try {
    const d = JSON.parse(fs.readFileSync(groupFile(g), 'utf8'));
    if (!d.collections) d.collections = {};
    return d;
  } catch (e) {
    return { collections: {}, updatedAt: null };
  }
}
function saveGroup(g, data) {
  const f = groupFile(g);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, f);
}
function ensureColl(data, c) {
  if (!data.collections[c]) data.collections[c] = {};
  return data.collections[c];
}

/* ---------- http helpers ---------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Group');
  res.setHeader('Access-Control-Max-Age', '600');
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function sendHtml(res, code, html) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function authOk(req) {
  if (!SYNC_TOKEN) return true;
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return !!m && m[1] === SYNC_TOKEN;
}

/* ---------- merge / pull ---------- */
function mergeCollection(store, incoming) {
  let applied = 0;
  for (const rec of (incoming || [])) {
    if (!rec || !rec.id) continue;
    const cur = store[rec.id];
    const curT = cur ? (Date.parse(cur.updatedAt || 0) || 0) : 0;
    const newT = Date.parse(rec.updatedAt || 0) || 0;
    if (!cur || newT >= curT) { store[rec.id] = rec; applied++; }
  }
  return applied;
}
function pullSince(store, since) {
  const arr = Object.values(store);
  if (!since) return arr;
  const t = Date.parse(since) || 0;
  return arr.filter(r => (Date.parse(r.updatedAt || 0) || 0) > t);
}

/* ---------- request handler ---------- */
const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);
  let pathname = parsed.pathname || '/';
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');

  /* status page */
  if (req.method === 'GET' && (pathname === '/' || pathname === '/status')) {
    let groups = [];
    try {
      groups = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    } catch (e) {}
    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hospital Meter Sync Server</title>
<style>
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:32px}
 .card{max-width:640px;margin:0 auto;background:#1e293b;border-radius:16px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
 h1{margin:0 0 4px;font-size:22px;color:#34d399}
 .ok{display:inline-block;background:#064e3b;color:#6ee7b7;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600}
 code{background:#0f172a;padding:2px 6px;border-radius:6px;color:#93c5fd}
 .kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155}
 .brand{margin-top:22px;font-size:12px;color:#94a3b8;text-align:center}
</style></head><body>
<div class="card">
  <h1>Hospital Meter Manager — Sync Server</h1>
  <p><span class="ok">● Online</span></p>
  <div class="kv"><span>Service</span><span>Cloud Sync v${VERSION}</span></div>
  <div class="kv"><span>Auth token</span><span>${SYNC_TOKEN ? 'Enabled' : 'Disabled (open)'}</span></div>
  <div class="kv"><span>Hospital groups</span><span>${groups.length ? groups.join(', ') : 'none yet'}</span></div>
  <div class="kv"><span>Sync endpoint</span><span><code>POST /api/sync</code></span></div>
  <div class="kv"><span>Health</span><span><code>GET /api/health</code></span></div>
  <div class="brand">${BRAND}</div>
</div></body></html>`;
    return sendHtml(res, 200, html);
  }

  /* health */
  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'Hospital Meter Sync', version: VERSION, time: new Date().toISOString() });
  }

  /* two-way sync */
  if (req.method === 'POST' && (pathname === '/api/sync' || pathname.startsWith('/api/sync/'))) {
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'Unauthorized' });
    let body;
    try { body = await readBody(req); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }

    const pathGroup = pathname.startsWith('/api/sync/') ? pathname.slice('/api/sync/'.length) : '';
    const group = safeGroup(body.group || req.headers['x-group'] || pathGroup || 'default');

    const data = loadGroup(group);
    const applied = {};
    COLLECTIONS.forEach(c => {
      applied[c] = mergeCollection(ensureColl(data, c), body.changes && body.changes[c]);
    });
    data.updatedAt = new Date().toISOString();
    saveGroup(group, data);

    const changes = {};
    COLLECTIONS.forEach(c => { changes[c] = pullSince(ensureColl(data, c), body.since); });

    return send(res, 200, {
      ok: true,
      group,
      serverTime: new Date().toISOString(),
      applied,
      changes
    });
  }

  /* pull only */
  if (req.method === 'GET' && pathname === '/api/pull') {
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'Unauthorized' });
    const group = safeGroup(parsed.query.group || req.headers['x-group'] || 'default');
    const data = loadGroup(group);
    const changes = {};
    COLLECTIONS.forEach(c => { changes[c] = pullSince(ensureColl(data, c), parsed.query.since); });
    return send(res, 200, { ok: true, group, serverTime: new Date().toISOString(), changes });
  }

  send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log('Hospital Meter Sync server listening on port ' + PORT);
  console.log('Data directory: ' + DATA_DIR);
  console.log('Auth token: ' + (SYNC_TOKEN ? 'enabled' : 'disabled'));
});
