import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { getCodespacesConfig } from '../server/codespaces.js';
import { createApp } from '../server/app.js';

const validEnv = {
  CODESPACES: 'true',
  CODESPACE_NAME: 'friendly-space-123',
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
};

test('Codespaces configuration requires explicit environment identity and forwarding domain', () => {
  for (const field of Object.keys(validEnv)) {
    const env = { ...validEnv };
    delete env[field];
    assert.throws(() => getCodespacesConfig(env), undefined, `missing ${field}`);
  }
  for (const value of ['false', 'TRUE', '1', true, '']) {
    assert.throws(() => getCodespacesConfig({ ...validEnv, CODESPACES: value }));
  }
});

test('Codespaces configuration rejects injected names and non-exact forwarding domains', () => {
  for (const name of ['space.evil', 'space/path', 'space:3000', '-space', 'space-', 'space--name', 'space\nname', '*', 'a'.repeat(64)]) {
    assert.throws(() => getCodespacesConfig({ ...validEnv, CODESPACE_NAME: name }), undefined, name);
  }
  for (const domain of ['https://app.github.dev', '*.github.dev', 'app.github.dev/path', 'app.github.dev:443', 'app.github.dev\n', '.app.github.dev', 'app..github.dev', 'a'.repeat(64) + '.dev']) {
    assert.throws(() => getCodespacesConfig({ ...validEnv, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: domain }), undefined, domain);
  }
});

test('Codespaces binds loopback port 3000 and derives exactly one forwarded hostname', () => {
  const config = getCodespacesConfig({ ...validEnv, CODESPACE_NAME: 'Friendly-Space-123', PORT: '8080', HOST: '0.0.0.0', RENDER_EXTERNAL_HOSTNAME: 'attacker.example' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.deepEqual(config.allowedHosts, ['friendly-space-123-3000.app.github.dev']);
});

test('Codespaces hostname configuration supports real same-origin API requests and rejects foreign hosts', async t => {
  const config = getCodespacesConfig(validEnv);
  const server = createApp({ allowedHosts: config.allowedHosts });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, config.host);
  await once(server, 'listening');
  const host = config.allowedHosts[0];
  const request = (headers, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: config.host, port: server.address().port, path: '/api/tasks', method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? JSON.stringify({ title: 'مهمة من المعاينة الخاصة' }) : undefined);
  });
  const created = await request({ host, origin: `https://${host}`, 'content-type': 'application/json' }, 'POST');
  assert.equal(created.status, 201);
  assert.equal(JSON.parse(created.body).task.title, 'مهمة من المعاينة الخاصة');
  for (const foreignHost of ['other-3000.app.github.dev', `${host}.evil.example`, 'attacker.example']) {
    assert.equal((await request({ host: foreignHost })).status, 403, foreignHost);
  }
  assert.equal((await request({ host, origin: 'https://attacker.example', 'content-type': 'application/json' }, 'POST')).status, 403);
  assert.equal(JSON.parse((await request({ host })).body).tasks.length, 1);
});
