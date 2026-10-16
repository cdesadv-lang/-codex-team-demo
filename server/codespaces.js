import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, validateHostname } from './app.js';

// The launcher must make port 3000 private through GitHub before starting this
// process. Authentication belongs to that private Codespaces forwarding proxy.
export function getCodespacesConfig(env = process.env) {
  if (env.CODESPACES !== 'true') throw new Error('This launcher requires GitHub Codespaces');
  const name = env.CODESPACE_NAME;
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(name)) {
    throw new Error('CODESPACE_NAME must be a valid Codespaces name');
  }
  const domain = validateHostname(env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN);
  const hostname = validateHostname(`${name}-3000.${domain}`);
  return {
    host: '127.0.0.1',
    port: 3000,
    allowedHosts: [hostname],
    dbPath: '/tmp/codex-codespace/tasks.sqlite',
    webRoot: fileURLToPath(new URL('../web/dist', import.meta.url)),
  };
}

export function startCodespaces(env = process.env) {
  const config = getCodespacesConfig(env);
  if (!statSync(path.join(config.webRoot, 'index.html')).isFile()) {
    throw new Error('Build the frontend before starting the Codespaces preview');
  }
  const server = createApp(config);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close();
    const deadline = setTimeout(() => {
      server.closeAllConnections();
    }, 5000);
    deadline.unref();
  };
  const cleanup = () => {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.once('close', cleanup);
  server.once('error', error => {
    cleanup();
    console.error(`Codespaces preview failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log('Codespaces preview listening on 127.0.0.1:3000; use the private forwarded port.');
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    startCodespaces();
  } catch (error) {
    console.error(`Codespaces preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}
