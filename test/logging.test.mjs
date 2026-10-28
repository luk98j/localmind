import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../dist/src/logging.js';
import { Core } from '../dist/src/core.js';
import { createApp } from '../dist/src/server.js';
function fixture(t) { const dir = mkdtempSync(join(tmpdir(), 'localmind-log-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('logs copy only allowlisted metadata and rotate into at most three archives', t => {
  const dir = fixture(t), { log, file } = createLogger(dir, { maxBytes: 250, output: () => {} });
  for (let i = 0; i < 15; i++) log('http.completed', { method: 'POST', route: '/api/notes?private-value', status: 400, body: 'private note content', authorization: 'Bearer synthetic-credential' });
  const names = readdirSync(join(dir, 'logs')); assert.ok(names.length <= 4); assert.ok(names.includes('localmind.log.3'));
  const content = names.map(name => readFileSync(join(dir, 'logs', name), 'utf8')).join('');
  assert.ok(!content.includes('private-value')); assert.ok(!content.includes('private note content')); assert.ok(!content.includes('synthetic-credential'));
  for (const line of content.trim().split('\n')) { const row = JSON.parse(line); assert.equal(row.route, 'unmatched'); assert.equal(row.status, 400); }
  if (process.platform !== 'win32') { assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(join(dir, 'logs')).mode & 0o777, 0o700); }
});
test('API and MCP failures are observable without logging input, note titles, tokens or query strings', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'localmind-log-')), logger = createLogger(dir, { output: () => {} }), core = new Core(dir), token = 'a'.repeat(64), app = createApp(core, token, 4317, logger.log);
  t.after(async () => { await app.close(); core.close(); rmSync(dir, { recursive: true, force: true }); });
  const headers = { host: '127.0.0.1:4317', authorization: 'Bearer ' + token };
  const content = { title: 'Private synthetic title', body: 'password=synthetic-rejected-value', parentId: null, thoughtAuthor: '' };
  await app.inject({ method: 'POST', url: '/api/notes?unlogged-query', headers, payload: content });
  await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_note', arguments: content } } });
  const text = readFileSync(logger.file, 'utf8');
  for (const value of [token, content.title, content.body, 'unlogged-query']) assert.ok(!text.includes(value));
  const events = text.trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e => e.event === 'http.completed' && e.route === '/api/notes' && e.status === 400));
  assert.ok(events.some(e => e.event === 'mcp.rejected' && e.tool === 'create_note'));
  assert.equal(core.events().length, 0);
});
