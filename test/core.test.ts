import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from '../src/core.js';
import { GitSync } from '../src/sync.js';
import { createApp } from '../src/server.js';
import { decrypt, encrypt, noSecrets } from '../src/security.js';
import { randomBytes } from 'node:crypto';
const note = (body = 'A useful idea', parentId: string | null = null) => ({ title: 'An idea', body, parentId, thoughtAuthor: 'Ada (declared)' });
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'localmind-test-')); const core = new Core(dir);
  t.after(() => { core.close(); rmSync(dir, { recursive: true, force: true }); }); return core;
}
function replica(t: any, source: Core) {
  const dir = mkdtempSync(join(tmpdir(), 'localmind-test-'));
  const first = new Core(dir); first.close();
  const file = join(dir, 'identity.json'), identity = JSON.parse(readFileSync(file, 'utf8'));
  identity.key = source.identity.key; writeFileSync(file, JSON.stringify(identity));
  const core = new Core(dir); core.trust(source.identity.publicKey); source.trust(core.identity.publicKey);
  t.after(() => { core.close(); rmSync(dir, { recursive: true, force: true }); }); return core;
}
test('signed encrypted history survives restart; SQL rejects updates/deletes', t => {
  const core = fixture(t), created = core.write(null, note(), []);
  const first = core.events()[0]; core.write(created.noteId, note('Updated'), [first.id]);
  assert.equal(core.history(created.noteId).length, 2);
  assert.equal(core.list()[0].body, 'Updated');
  assert.equal(core.history(created.noteId)[0].signerId, core.signerId);
  assert.equal(core.history(created.noteId)[0].content.thoughtAuthor, 'Ada (declared)');
  assert.ok(!JSON.stringify(core.events()).includes('A useful idea'));
  assert.throws(() => core.db.exec('DELETE FROM events'), /append-only/);
  assert.throws(() => core.db.exec("UPDATE events SET document='{}'"), /append-only/);
  const reopened = new Core(core.dir); assert.equal(reopened.list()[0].body, 'Updated'); reopened.close();
});
test('authenticated encryption detects altered content and associated metadata', () => {
  const key = randomBytes(32), box = encrypt({ text: 'hello' }, key, 'header');
  assert.deepEqual(decrypt(box, key, 'header'), { text: 'hello' });
  assert.throws(() => decrypt(box, key, 'other header'));
  assert.throws(() => decrypt({ ...box, tag: randomBytes(16).toString('base64') }, key, 'header'));
});
test('Unicode notes at the text limit can be exported and imported', t => {
  const a = fixture(t), b = replica(t, a), body = '界'.repeat(100000);
  a.write(null, note(body), []);
  const source = new GitSync(a).export(), target = new GitSync(b);
  for (const e of a.events()) writeFileSync(join(target.directory(), e.id + '.json'), readFileSync(join(source.directory, e.id + '.json')));
  assert.equal(target.import().imported, 1); assert.equal(b.list()[0].body, body);
});
test('secret detection blocks fields before persistence and returns no secret value', t => {
  const core = fixture(t);
  for (const secret of ['password=hunter-example', '{"password":"synthetic-test-value"}', 'ghp_' + 'x'.repeat(36), '-----BEGIN PRIVATE KEY-----', 'Bearer abcdefghijklmnop', 'https://user:example-password@example.com', 'postgres://user:synthetic-value@example.com/db']) {
    assert.throws(() => core.write(null, note(secret), []), /Possible secret detected/);
  }
  assert.throws(() => core.write(null, { ...note(), thoughtAuthor: 'api_key=example-secret-value' }, []));
  assert.equal(core.events().length, 0);
  assert.doesNotThrow(() => noSecrets('Never store passwords. Use a password manager.'));
});
test('stale writes and tree cycles are rejected', t => {
  const core = fixture(t), root = core.write(null, note(), []), child = core.write(null, note('Child', root.noteId), []);
  assert.throws(() => core.write(root.noteId, note('stale'), []), /Stale/);
  assert.throws(() => core.write(root.noteId, note('Cycle', child.noteId), [root.eventId]), /cycle/);
  assert.throws(() => core.write(null, note('Orphan', 'missing'), []), /Missing note parent/);
});
test('parallel branches require human resolution and retain complete history', t => {
  const a = fixture(t), b = replica(t, a), root = a.write(null, note(), []);
  b.import(a.events()); a.write(root.noteId, note('Branch A'), [root.eventId]); b.write(root.noteId, note('Branch B'), [root.eventId]);
  const result = a.import(b.events().reverse()); assert.deepEqual(result.conflicts, [root.noteId]);
  const heads = a.list()[0].heads; assert.equal(heads.length, 2);
  assert.throws(() => a.write(root.noteId, note('Merged'), heads), /Human/);
  const resolution = a.write(root.noteId, note('Reviewed merged text'), heads, true);
  assert.equal(a.list()[0].conflicted, false); assert.deepEqual(a.events().at(-1)!.parents.sort(), heads.sort());
  b.import(a.events()); assert.equal(b.list()[0].body, 'Reviewed merged text'); assert.equal(b.list()[0].heads[0], resolution.eventId);
  assert.equal(a.history(root.noteId).length, 4); assert.equal(a.import(b.events()).imported, 0);
});
test('imports are atomic, enforce trust, and reject tampering and ID collisions', t => {
  const a = fixture(t), b = replica(t, a), stranger = fixture(t);
  a.write(null, note(), []); const valid = a.events()[0];
  const bad = { ...valid, id: 'tampered' };
  assert.throws(() => b.import([valid, bad]), /signature/); assert.equal(b.events().length, 0);
  assert.throws(() => stranger.import([valid]), /Untrusted/);
  b.import([valid]); assert.throws(() => b.import([{ ...valid, signature: 'changed' }]), /collision/);
});
test('wrong workspace keys cannot import events', t => {
  const a = fixture(t), b = fixture(t); b.trust(a.identity.publicKey); a.write(null, note(), []);
  assert.throws(() => b.import(a.events()), /Cannot decrypt/); assert.equal(b.events().length, 0);
});
test('Git exchange exports only encrypted signed events and has no network operation', t => {
  const a = fixture(t), b = replica(t, a); a.write(null, note('Private note text'), []);
  const sync = new GitSync(a), exported = sync.export(); assert.equal(exported.count, 1); sync.export();
  const content = readFileSync(join(exported.directory, a.events()[0].id + '.json'), 'utf8'); assert.ok(!content.includes('Private note text'));
  assert.equal(sync.plan('https://github.com/example/localmind.git').networkEnabled, false);
  assert.throws(() => sync.plan('https://user:password@github.com/example/repo'));
  assert.throws(() => sync.plan('file:///etc/passwd'));
  const bSync = new GitSync(b); writeFileSync(join(bSync.directory(), a.events()[0].id + '.json'), content);
  assert.equal(bSync.import().imported, 1);
});
const token = 'a'.repeat(64), headers = { host: '127.0.0.1:4317', authorization: 'Bearer ' + token };
test('HTTP authorization, host/origin checks, secret policy and static UI', async t => {
  const core = fixture(t), app = createApp(core, token); t.after(() => app.close());
  assert.equal((await app.inject({ url: '/api/notes', headers: { host: headers.host } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/notes', headers: { ...headers, origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/notes', headers: { ...headers, host: 'evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/notes', headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/', headers: { host: headers.host, 'sec-fetch-site': 'cross-site' } })).statusCode, 200);
  const secret = await app.inject({ method: 'POST', url: '/api/notes', headers, payload: note('password=do-not-save-this') });
  assert.equal(secret.statusCode, 400); assert.ok(!secret.body.includes('do-not-save-this')); assert.equal(core.events().length, 0);
  const created = await app.inject({ method: 'POST', url: '/api/notes', headers, payload: note() }); assert.equal(created.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/notes', headers })).json().length, 1);
  const page = await app.inject({ url: '/', headers: { host: headers.host } }); assert.equal(page.statusCode, 200); assert.match(page.body, /LocalMind/); assert.match(page.headers['content-security-policy'] as string, /frame-ancestors 'none'/);
});
test('MCP initializes, exposes mandatory policy, calls tools, and blocks secrets', async t => {
  const core = fixture(t), app = createApp(core, token); t.after(() => app.close());
  const rpc = async (method: string, params: object = {}) => (await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method, params } })).json();
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-11-25'); assert.match(init.result.instructions, /NEVER/);
  assert.match((await rpc('resources/read', { uri: 'knowledge://agent-policy' })).result.contents[0].text, /password manager/);
  assert.equal((await rpc('tools/list')).result.tools.length, 4);
  assert.ok(!(await rpc('tools/list')).result.tools.some((t: any) => /resolve/.test(t.name)));
  const bad = await rpc('tools/call', { name: 'create_note', arguments: note('api_key=not-a-real-secret') }); assert.equal(bad.result.isError, true); assert.equal(core.events().length, 0);
  await rpc('tools/call', { name: 'create_note', arguments: note() }); assert.equal(core.events().length, 1);
  assert.equal((await rpc('unknown')).error.code, -32601);
  assert.equal((await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })).statusCode, 202);
  assert.equal((await app.inject({ url: '/mcp', headers })).statusCode, 405);
});
