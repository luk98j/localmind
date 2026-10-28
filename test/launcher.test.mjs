import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare, fingerprints, openBrowser } from '../scripts/launch.mjs';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'localmind-launcher-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/main.ts'), 'export const value = 1;');
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) writeFileSync(join(dir, name), '{}');
  return dir;
}
function steps() {
  const calls = [];
  const install = base => { calls.push('install'); mkdirSync(join(base, 'node_modules/fastify'), { recursive: true }); mkdirSync(join(base, 'node_modules/typescript/bin'), { recursive: true }); writeFileSync(join(base, 'node_modules/fastify/package.json'), '{}'); writeFileSync(join(base, 'node_modules/typescript/bin/tsc'), ''); };
  const build = base => { calls.push('build'); mkdirSync(join(base, 'dist/src'), { recursive: true }); writeFileSync(join(base, 'dist/src/main.js'), ''); };
  return { calls, install, build, report: () => {} };
}
test('launcher prepares once, rebuilds code changes and reinstalls only changed dependencies', t => {
  const base = fixture(t), run = steps();
  assert.deepEqual(prepare(base, run), { installed: true, built: true });
  assert.deepEqual(prepare(base, run), { installed: false, built: false });
  writeFileSync(join(base, 'src/main.ts'), 'export const value = 2;');
  assert.deepEqual(prepare(base, run), { installed: false, built: true });
  writeFileSync(join(base, 'package-lock.json'), '{"lockfileVersion":3}');
  assert.deepEqual(prepare(base, run), { installed: true, built: true });
  assert.deepEqual(run.calls, ['install', 'build', 'build', 'install', 'build']);
});
test('notebook data and application logs do not affect preparation or get scanned', t => {
  const base = fixture(t), before = fingerprints(base); mkdirSync(join(base, 'data'));
  writeFileSync(join(base, 'data/core.sqlite'), 'synthetic notebook content');
  writeFileSync(join(base, 'data/localmind.log'), 'synthetic diagnostic output');
  assert.deepEqual(fingerprints(base), before);
});
test('failed preparation is retryable and concurrent setup does not replace an active lock', t => {
  const base = fixture(t), run = steps();
  assert.throws(() => prepare(base, { ...run, install: () => { throw new Error('synthetic failure'); } }), /synthetic failure/);
  assert.equal(existsSync(join(base, '.localmind/prepare.lock')), false);
  assert.equal(existsSync(join(base, '.localmind/prepared.json')), false);
  prepare(base, run);
  const lock = join(base, '.localmind/prepare.lock'), content = JSON.stringify({ pid: process.pid }); writeFileSync(lock, content);
  assert.throws(() => prepare(base, run), /Another setup/); assert.equal(readFileSync(lock, 'utf8'), content);
});
test('missing build output and dependency markers trigger repair', t => {
  const base = fixture(t), run = steps(); prepare(base, run);
  rmSync(join(base, 'dist/src/main.js'));
  assert.deepEqual(prepare(base, run), { installed: false, built: true });
  rmSync(join(base, 'node_modules/fastify/package.json'));
  assert.deepEqual(prepare(base, run), { installed: true, built: true });
});
test('browser launch uses fixed native commands and refuses external or credential URLs', () => {
  const calls = [], fake = (...args) => { calls.push(args); return { on() {}, unref() {} }; };
  openBrowser('http://127.0.0.1:4317', 'darwin', fake);
  openBrowser('http://127.0.0.1:4317', 'win32', fake);
  assert.equal(calls[0][0], 'open'); assert.equal(calls[1][0], 'rundll32.exe'); assert.equal(calls[1][2].shell, false);
  assert.throws(() => openBrowser('https://example.com', 'darwin', fake));
  assert.throws(() => openBrowser('http://user:pass@127.0.0.1', 'darwin', fake));
  assert.throws(() => openBrowser('http://127.0.0.1/#credential', 'darwin', fake));
});
