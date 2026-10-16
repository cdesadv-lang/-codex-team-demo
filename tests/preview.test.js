import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const password = 'preview-test-only-password-123456';
const authorization = `Basic ${Buffer.from(`preview:${password}`).toString('base64')}`;

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'preview-test-'));
  await writeFile(join(dir, 'index.html'), '<html lang="ar" dir="rtl">PRIVATE_UI_SENTINEL</html>');
  const server = createApp({ webRoot: dir, previewPassword: password, ...options });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (path = '/', { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('preview challenges unauthenticated UI, assets and API without leaking protected content', async t => {
  const request = await fixture(t);
  for (const path of ['/', '/index.html', '/missing.js', '/api/tasks', '/api/unknown']) {
    const response = await request(path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers['www-authenticate'], /^Basic /i);
    assert.doesNotMatch(response.body, /PRIVATE_UI_SENTINEL|"tasks"/);
  }
  for (const credentials of ['preview:wrong', `other:${password}`]) {
    assert.equal((await request('/api/tasks', { headers: { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` } })).status, 401);
  }
});

test('authenticated preview supports the real UI and complete task lifecycle', async t => {
  const request = await fixture(t);
  const headers = { authorization, 'content-type': 'application/json' };
  assert.match((await request('/', { headers })).body, /PRIVATE_UI_SENTINEL/);
  const created = await request('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ title: 'معاينة خاصة' }) });
  assert.equal(created.status, 201);
  const { task } = JSON.parse(created.body);
  assert.deepEqual(JSON.parse((await request('/api/tasks', { headers })).body).tasks, [task]);
  const updated = await request(`/api/tasks/${task.id}`, { method: 'PATCH', headers, body: '{"completed":true}' });
  assert.equal(updated.status, 200);
  assert.equal(JSON.parse(updated.body).task.completed, true);
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'DELETE', headers })).status, 204);
  assert.deepEqual(JSON.parse((await request('/api/tasks', { headers })).body), { tasks: [] });
});

test('authentication does not bypass cross-origin write protection', async t => {
  const request = await fixture(t);
  const response = await request('/api/tasks', { method: 'POST', headers: { authorization, origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{"title":"blocked"}' });
  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse((await request('/api/tasks', { headers: { authorization } })).body), { tasks: [] });
});

test('preview permits only explicitly configured external hosts', async t => {
  const request = await fixture(t, { allowedHosts: ['preview.example.com'] });
  assert.equal((await request('/', { headers: { host: 'preview.example.com', authorization } })).status, 200);
  assert.equal((await request('/', { headers: { host: 'preview.example.com' } })).status, 401);
  for (const host of ['sub.preview.example.com', 'preview.example.com.evil.example', 'evilpreview.example.com', 'other.example.com']) {
    assert.equal((await request('/', { headers: { host, authorization } })).status, 403, host);
  }
});

test('health checks expose only status and require no credentials', async t => {
  const request = await fixture(t);
  const response = await request('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
  const head = await request('/healthz', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await request('/healthz', { method: 'POST' })).status, 401);
});

test('invalid preview configuration fails before serving requests', () => {
  for (const previewPassword of ['', 'short', null, 123, 'x'.repeat(23)]) {
    assert.throws(() => createApp({ previewPassword }), undefined, `password type ${typeof previewPassword}`);
  }
  for (const allowedHosts of ['preview.example.com', null, [null], [''], ['https://preview.example.com'], ['*.example.com'], ['example.com/path'], ['example.com:443']]) {
    assert.throws(() => createApp({ allowedHosts }), undefined, 'invalid host configuration');
  }
});
