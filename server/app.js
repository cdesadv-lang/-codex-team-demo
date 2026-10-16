import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';

export function validateHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length > 253 || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(hostname) || hostname.split('.').some(label => label.length > 63)) throw new Error('Expected an exact DNS hostname without a port or wildcard');
  return hostname.toLowerCase();
}

const digest = value => createHash('sha256').update(value).digest();

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const taskJSON = row => ({ id: Number(row.id), title: row.title, completed: Boolean(row.completed) });
const fail = (status, message) => Object.assign(new Error(message), { status });

async function bodyJSON(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Content-Type must be application/json');
  const chunks = await new Promise((resolve, reject) => {
    let size = 0;
    let oversized = false;
    const buffered = [];
    req.on('data', chunk => {
      if (oversized) return; // Continue draining without retaining more request data.
      size += chunk.length;
      if (size > 4096) {
        oversized = true;
        buffered.length = 0;
        reject(fail(413, 'Request body is too large'));
      } else buffered.push(chunk);
    });
    req.once('end', () => { if (!oversized) resolve(buffered); });
    req.once('error', reject);
    req.once('aborted', () => reject(fail(400, 'Request body was aborted')));
  });
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Expected a JSON object');
  return value;
}

export function createApp({ dbPath = ':memory:', webRoot, allowedHosts = [], previewPassword } = {}) {
  if (!Array.isArray(allowedHosts)) throw new Error('allowedHosts must be an array');
  const hostnames = new Set(allowedHosts.map(validateHostname));
  if (previewPassword !== undefined && (typeof previewPassword !== 'string' || previewPassword.length < 24)) throw new Error('Preview password must contain at least 24 characters');
  const expectedCredential = previewPassword === undefined ? null : digest(`preview:${previewPassword}`);
  if (dbPath !== ':memory:') mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)))');
  const list = db.prepare('SELECT id, title, completed FROM tasks ORDER BY id DESC');
  const get = db.prepare('SELECT id, title, completed FROM tasks WHERE id = ?');
  const insert = db.prepare('INSERT INTO tasks (title) VALUES (?)');
  const update = db.prepare('UPDATE tasks SET completed = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM tasks WHERE id = ?');
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) return json(res, 200, { status: 'ok' });
      const host = req.headers.host || '';
      const external = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(host);
      if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host) && !(external && hostnames.has(external[1].toLowerCase()) && (!external[2] || Number(external[2]) <= 65535))) throw fail(403, 'Host is not allowed');
      if (expectedCredential) {
        const authorization = req.headers.authorization || '';
        const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
        const suppliedCredential = digest(basic ? Buffer.from(basic[1], 'base64') : '');
        if (!timingSafeEqual(expectedCredential, suppliedCredential)) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Private preview", charset="UTF-8"');
          throw fail(401, 'Authentication required');
        }
      }
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw fail(403, 'Origin is not allowed'); }
          if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host || origin.origin !== req.headers.origin) throw fail(403, 'Origin is not allowed');
        }
        if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: list.all().map(taskJSON) });
        if (url.pathname === '/api/tasks' && req.method === 'POST') {
          const body = await bodyJSON(req);
          if (Object.keys(body).some(key => key !== 'title') || typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 200) throw fail(400, 'Title must contain 1 to 200 characters');
          const result = insert.run(body.title.trim());
          return json(res, 201, { task: taskJSON(get.get(result.lastInsertRowid)) });
        }
        const match = /^\/api\/tasks\/([1-9]\d*)$/.exec(url.pathname);
        if (match && ['PATCH', 'DELETE'].includes(req.method)) {
          const id = Number(match[1]);
          if (!Number.isSafeInteger(id) || !get.get(id)) throw fail(404, 'Task not found');
          if (req.method === 'DELETE') { remove.run(id); res.writeHead(204); return res.end(); }
          const body = await bodyJSON(req);
          if (Object.keys(body).some(key => key !== 'completed') || typeof body.completed !== 'boolean') throw fail(400, 'Completed must be a boolean');
          update.run(Number(body.completed), id);
          return json(res, 200, { task: taskJSON(get.get(id)) });
        }
        throw fail(404, 'API route not found');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method not allowed');
      if (!webRoot) throw fail(404, 'Frontend is not built');
      let root, file;
      try {
        root = realpathSync(webRoot);
        const decoded = decodeURIComponent(url.pathname);
        if (decoded.includes('\0') || decoded.includes('\\')) throw fail(400, 'Invalid path');
        file = realpathSync(path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded)));
        if (!file.startsWith(root + path.sep) || !statSync(file).isFile()) throw fail(404, 'File not found');
      } catch (error) { throw fail(error.status || 404, error.status ? error.message : 'File not found'); }
      const contents = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
      else res.end();
    }
  });
  server.on('close', () => db.close());
  return server;
}
