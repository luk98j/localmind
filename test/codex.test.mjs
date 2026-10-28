import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { install, configBlock, localUrl, checkConnection, root } from '../scripts/setup-codex.mjs';
import { readToken } from '../scripts/codex-headers.mjs';
import { Core } from '../dist/src/core.js';
import { createApp } from '../dist/src/server.js';
const fakeToken = 'a'.repeat(64);
function fixture(t, autoCleanup = true) {
  const dir = mkdtempSync(join(tmpdir(), 'localmind-codex-'));
  if (autoCleanup) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'api-token');
  writeFileSync(tokenFile, fakeToken, { mode: 0o600 });
  return { dir, tokenFile, url: 'http://127.0.0.1:4317/mcp' };
}
test('Codex installer preserves existing configuration and instructions, and is idempotent', t => {
  const f = fixture(t); mkdirSync(join(f.dir, '.codex'));
  writeFileSync(join(f.dir, '.codex/config.toml'), '[mcp_servers.existing]\nurl = "https://example.com/mcp"\n');
  writeFileSync(join(f.dir, 'AGENTS.md'), '# Project rules\nKeep the original rules.\n');
  const paths = install(f.dir, f), config = readFileSync(paths.configFile, 'utf8'), agents = readFileSync(paths.agentsFile, 'utf8');
  assert.match(config, /mcp_servers.existing/); assert.match(config, /http_headers_helper/); assert.match(config, /approval_mode = "writes"/);
  assert.ok(!config.includes(fakeToken)); assert.match(agents, /Keep the original rules/); assert.match(agents, /NEVER/);
  install(f.dir, f);
  assert.equal(readFileSync(paths.configFile, 'utf8'), config); assert.equal(readFileSync(paths.agentsFile, 'utf8'), agents);
});
test('installer refuses unmanaged duplicate servers, symlinks and malformed blocks without changing instructions', t => {
  const f = fixture(t); mkdirSync(join(f.dir, '.codex')); const config = join(f.dir, '.codex/config.toml');
  writeFileSync(join(f.dir, 'AGENTS.md'), 'Original instructions');
  for (const existing of ['[mcp_servers.localmind]\nurl = "http://localhost:1/mcp"', '[mcp_servers."localmind"]\nurl = "http://localhost:1/mcp"', '# BEGIN LOCALMIND MANAGED CONFIG\nunfinished']) {
    writeFileSync(config, existing); assert.throws(() => install(f.dir, f)); assert.equal(readFileSync(config, 'utf8'), existing);
    assert.equal(readFileSync(join(f.dir, 'AGENTS.md'), 'utf8'), 'Original instructions');
  }
  if (process.platform !== 'win32') { rmSync(config); symlinkSync(f.tokenFile, config); assert.throws(() => install(f.dir, f), /unsafe/); }
});
test('credential helper reads owner-only files and emits no credential on failure', t => {
  const f = fixture(t); assert.equal(readToken(f.tokenFile), fakeToken);
  const helper = join(root, 'scripts/codex-headers.mjs');
  const success = JSON.parse(execFileSync(process.execPath, [helper, f.tokenFile], { encoding: 'utf8' }));
  assert.equal(success.Authorization, 'Bearer ' + fakeToken);
  writeFileSync(f.tokenFile, fakeToken + '\nInjected: header');
  const failed = spawnSync(process.execPath, [helper, f.tokenFile], { encoding: 'utf8' });
  assert.equal(failed.status, 1); assert.equal(failed.stdout, ''); assert.ok(!failed.stderr.includes(fakeToken));
  if (process.platform !== 'win32') { writeFileSync(f.tokenFile, fakeToken); chmodSync(f.tokenFile, 0o644); assert.throws(() => readToken(f.tokenFile), /owner-only/); }
});
test('generated helper command safely handles spaces, quotes and shell syntax in paths', t => {
  if (process.platform === 'win32') return t.skip('POSIX shell helper');
  const f = fixture(t), folder = join(f.dir, "space ' $(echo unexpected)"); mkdirSync(folder);
  const tokenFile = join(folder, 'api-token'); writeFileSync(tokenFile, fakeToken, { mode: 0o600 });
  const block = configBlock({ ...f, tokenFile });
  const line = block.split('\n').find(line => line.startsWith('http_headers_helper = '));
  const command = JSON.parse(line.slice('http_headers_helper = '.length));
  const result = JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }));
  assert.equal(result.Authorization, 'Bearer ' + fakeToken);
});
test('nonlocal or credential-bearing URLs are rejected before the token can be sent', () => {
  for (const url of ['https://example.com/mcp', 'http://127.0.0.1.evil.example/mcp', 'http://user:pass@localhost/mcp', 'http://127.0.0.1/mcp?token=x', 'http://localhost/other']) assert.throws(() => localUrl(url));
  assert.equal(localUrl('http://127.0.0.1:4317/mcp'), 'http://127.0.0.1:4317/mcp');
});
test('connection check performs the MCP handshake and confirms policy without reading notes', async t => {
  const f = fixture(t, false), core = new Core(join(f.dir, 'workspace')), app = createApp(core, fakeToken);
  t.after(async () => { await app.close(); core.close(); rmSync(f.dir, { recursive: true, force: true }); });
  const methods = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error'); methods.push(JSON.parse(options.body).method);
    const response = await app.inject({ method: 'POST', url: new URL(url).pathname, headers: { ...options.headers, host: '127.0.0.1:4317' }, payload: options.body });
    return { ok: response.statusCode < 300, json: async () => response.json() };
  };
  assert.deepEqual(await checkConnection({ ...f, fetchImpl }), { server: 'LocalMind', tools: 5, policy: 'available' });
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'resources/read']);
  assert.equal(core.events().length, 0);
});
