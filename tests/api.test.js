import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-team-test-'));
  const webRoot = join(dir, 'web');
  await mkdir(webRoot);
  await writeFile(join(webRoot, 'index.html'), '<html lang="ar" dir="rtl">test</html>');
  await writeFile(join(dir, 'secret.txt'), 'PRIVATE_FIXTURE_SENTINEL');
  const dbPath = join(dir, 'tasks.sqlite');
  let server;
  async function start() {
    server = createApp({ dbPath, webRoot });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  return { start, stop };
}

function json(method, body, headers = {}) {
  return { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

test('CRUD stores tasks in SQLite and survives reopening the application', async t => {
  const app = await fixture(t);
  let base = await app.start();
  assert.deepEqual(await (await fetch(`${base}/api/tasks`)).json(), { tasks: [] });
  let response = await fetch(`${base}/api/tasks`, json('POST', { title: 'مراجعة الإصدار' }));
  assert.equal(response.status, 201);
  const { task } = await response.json();
  assert.ok(Number.isInteger(task.id));
  assert.equal(task.title, 'مراجعة الإصدار');
  assert.equal(task.completed, false);
  response = await fetch(`${base}/api/tasks/${task.id}`, json('PATCH', { completed: true }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).task, { ...task, completed: true });
  await app.stop();
  base = await app.start();
  assert.deepEqual((await (await fetch(`${base}/api/tasks`)).json()).tasks, [{ ...task, completed: true }]);
  response = await fetch(`${base}/api/tasks/${task.id}`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual((await (await fetch(`${base}/api/tasks`)).json()).tasks, []);
});

test('invalid task input and malformed JSON are rejected without changing storage', async t => {
  const app = await fixture(t);
  const base = await app.start();
  for (const body of [{}, { title: '' }, { title: '   ' }, { title: 42 }, { title: 'a'.repeat(201) }]) {
    const response = await fetch(`${base}/api/tasks`, json('POST', body));
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const malformed = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const created = await (await fetch(`${base}/api/tasks`, json('POST', { title: 'valid' }))).json();
  for (const completed of ['true', 1, null]) {
    const response = await fetch(`${base}/api/tasks/${created.task.id}`, json('PATCH', { completed }));
    assert.equal(response.status, 400);
  }
  const tasks = (await (await fetch(`${base}/api/tasks`)).json()).tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].completed, false);
});

test('missing IDs and unknown API routes return errors', async t => {
  const app = await fixture(t);
  const base = await app.start();
  for (const options of [json('PATCH', { completed: true }), { method: 'DELETE' }]) {
    assert.equal((await fetch(`${base}/api/tasks/999999`, options)).status, 404);
  }
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
});

test('oversized and cross-origin writes are blocked', async t => {
  const app = await fixture(t);
  const base = await app.start();
  const oversized = await fetch(`${base}/api/tasks`, json('POST', { title: 'x'.repeat(1024 * 1024) }));
  assert.equal(oversized.status, 413);
  const crossOrigin = await fetch(`${base}/api/tasks`, json('POST', { title: 'blocked' }, { Origin: 'https://attacker.example' }));
  assert.equal(crossOrigin.status, 403);
  const sameOrigin = await fetch(`${base}/api/tasks`, json('POST', { title: 'allowed' }, { Origin: base }));
  assert.equal(sameOrigin.status, 201);
});

test('serves the UI and does not expose files outside its web root', async t => {
  const app = await fixture(t);
  const base = await app.start();
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  for (const path of ['/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/%2e%2e/secret.txt']) {
    const response = await fetch(base + path);
    assert.notEqual(response.status, 500);
    assert.doesNotMatch(await response.text(), /PRIVATE_FIXTURE_SENTINEL/);
  }
});

test('rejects untrusted Host and stores SQL-like text literally with security headers', async t => {
  const app = await fixture(t);
  const base = await app.start();
  const deniedStatus = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/tasks`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(deniedStatus, 403);
  const unsupported = await fetch(`${base}/api/tasks`, { method: 'POST', body: 'title=bad' });
  assert.equal(unsupported.status, 415);
  const title = "'); DROP TABLE tasks; --";
  const created = await fetch(`${base}/api/tasks`, json('POST', { title }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).task.title, title);
  const listed = await fetch(`${base}/api/tasks`);
  assert.equal((await listed.json()).tasks.length, 1);
  assert.equal(listed.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(listed.headers.get('x-frame-options'), 'DENY');
  assert.match(listed.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
