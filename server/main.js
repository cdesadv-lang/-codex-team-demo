import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, validateHostname } from './app.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
const previewMode = process.env.PREVIEW_MODE === 'true';
if (process.env.PREVIEW_MODE !== undefined && !['true', 'false'].includes(process.env.PREVIEW_MODE)) throw new Error('PREVIEW_MODE must be true or false');
if (previewMode && (typeof process.env.PREVIEW_PASSWORD !== 'string' || process.env.PREVIEW_PASSWORD.length < 24)) throw new Error('Preview mode requires PREVIEW_PASSWORD with at least 24 characters');
const allowedHosts = previewMode ? [validateHostname(process.env.RENDER_EXTERNAL_HOSTNAME)] : [];
const server = createApp({ dbPath: process.env.DB_PATH || path.join(projectRoot, 'data/tasks.sqlite'), webRoot: path.join(projectRoot, 'web/dist'), allowedHosts, previewPassword: previewMode ? process.env.PREVIEW_PASSWORD : undefined });
const bindHost = previewMode ? '0.0.0.0' : '127.0.0.1';
server.listen(port, bindHost, () => console.log(`Task app listening on ${bindHost}:${server.address().port}${previewMode ? ' (authenticated preview)' : ''}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
