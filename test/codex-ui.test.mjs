import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, parse } from 'node:path';
import { Core } from '../dist/src/core.js';
import { createApp } from '../dist/src/server.js';
import { prepareInstall, applyInstallPlans } from '../scripts/setup-codex.mjs';

const token = 'b'.repeat(64);
const headers = { host: '127.0.0.1:4317', authorization: 'Bearer ' + token };
const uiTest = process.platform === 'win32' ? test.skip : test;
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'localmind-project-ui-')));
  const core = new Core(join(dir, 'notebook')), logs = [];
  const app = createApp(core, token, 4317, (event, fields) => logs.push({ event, ...fields }));
  t.after(async () => { await app.close(); core.close(); rmSync(dir, { recursive: true, force: true }); });
  const project = name => { const path = join(dir, name); mkdirSync(path); return path; };
  const request = (url, payload, extraHeaders = {}) => app.inject({ method: payload === undefined ? 'GET' : 'POST', url: '/api/integrations/codex' + url, headers: { ...headers, ...extraHeaders }, payload });
  const preview = async projects => {
    const response = await request('/preview', { projects }); assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  return { dir, core, app, project, request, preview, logs };
}

uiTest('UI previews and connects eight existing projects without credentials, uploads or note writes', async t => {
  const f = fixture(t), projects = Array.from({ length: 8 }, (_, i) => f.project('Project ' + (i + 1)));
  mkdirSync(join(projects[0], '.codex'));
  const original = '[mcp_servers.other]\nurl = "https://example.com/mcp"\nhttp_headers = { "X-Private" = "private-existing-setting" }\n';
  writeFileSync(join(projects[0], '.codex/config.toml'), original);
  writeFileSync(join(projects[0], 'AGENTS.md'), '# Existing rules\nKeep these instructions.\n');
  writeFileSync(join(projects[0], '.gitignore'), 'build/\n');
  const preview = await f.preview(projects);
  assert.equal(preview.projects.length, 8);
  assert.deepEqual(preview.projects[0].files.map(file => file.action), ['update', 'update', 'update']);
  assert.deepEqual(preview.projects[1].files.map(file => file.action), ['create', 'create', 'create']);
  assert.equal(existsSync(join(projects[1], '.codex')), false);
  assert.equal(readFileSync(join(projects[0], '.codex/config.toml'), 'utf8'), original);
  assert.equal(existsSync(join(f.core.dir, 'codex-projects.json')), false);
  assert.ok(!JSON.stringify(preview).includes('private-existing-setting'));
  const response = await f.request('/connect', { projects, previewToken: preview.previewToken, approved: true });
  assert.equal(response.statusCode, 200, response.body);
  for (const path of projects) {
    const config = readFileSync(join(path, '.codex/config.toml'), 'utf8');
    assert.match(config, /mcp_servers.localmind/); assert.ok(!config.includes(token));
    assert.match(readFileSync(join(path, 'AGENTS.md'), 'utf8'), /NEVER submit passwords/);
    assert.match(readFileSync(join(path, '.gitignore'), 'utf8'), /\/\.codex\/config.toml/);
    assert.equal(lstatSync(join(path, '.codex/config.toml')).mode & 0o777, 0o600);
  }
  assert.ok(readFileSync(join(projects[0], '.codex/config.toml'), 'utf8').startsWith(original));
  assert.match(readFileSync(join(projects[0], 'AGENTS.md'), 'utf8'), /Keep these instructions/);
  assert.match(readFileSync(join(projects[0], '.gitignore'), 'utf8'), /^build\//);
  const listed = await f.request('');
  assert.deepEqual(listed.json().projects, [...projects].sort());
  assert.equal(listed.json().sharedNotebook, true);
  const repeated = await f.preview(projects);
  assert.ok(repeated.projects.every(project => project.files.every(file => file.action === 'unchanged')));
  assert.equal((await f.request('/connect', { projects, previewToken: repeated.previewToken, approved: true })).statusCode, 200);
  assert.equal(f.core.events().length, 0);
  assert.ok(!JSON.stringify(f.logs).includes(projects[0]));
  assert.ok(!JSON.stringify(f.logs).includes('private-existing-setting'));
});

uiTest('setup requires authentication, same-site access, preview and explicit approval', async t => {
  const f = fixture(t), projects = [f.project('A')];
  assert.equal((await f.request('', undefined, { authorization: '' })).statusCode, 401);
  assert.equal((await f.request('/preview', { projects }, { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await f.request('/connect', { projects, approved: true, previewToken: 'a'.repeat(64) }, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  const preview = await f.preview(projects);
  assert.equal((await f.request('/connect', { projects, previewToken: preview.previewToken })).statusCode, 400);
  assert.equal((await f.request('/connect', { projects, approved: true, previewToken: 'a'.repeat(64) })).statusCode, 409);
  assert.equal(existsSync(join(projects[0], '.codex')), false);
  assert.equal(existsSync(join(f.core.dir, 'codex-projects.json')), false);
});

uiTest('stale previews and a changed project list cannot overwrite files or partially connect a batch', async t => {
  const f = fixture(t), projects = [f.project('A'), f.project('B')];
  const preview = await f.preview(projects);
  writeFileSync(join(projects[1], 'AGENTS.md'), 'Newly edited rules.\n');
  const stale = await f.request('/connect', { projects, previewToken: preview.previewToken, approved: true });
  assert.equal(stale.statusCode, 409);
  assert.equal(existsSync(join(projects[0], '.codex')), false);
  assert.equal(readFileSync(join(projects[1], 'AGENTS.md'), 'utf8'), 'Newly edited rules.\n');
  const newPreview = await f.preview(projects), third = [f.project('C')], thirdPreview = await f.preview(third);
  assert.equal((await f.request('/connect', { projects: third, previewToken: thirdPreview.previewToken, approved: true })).statusCode, 200);
  assert.equal((await f.request('/connect', { projects, previewToken: newPreview.previewToken, approved: true })).statusCode, 409);
  assert.equal(existsSync(join(projects[0], '.codex')), false);
});

uiTest('invalid targets and unsafe files reject the whole preview without modifying any project', async t => {
  const f = fixture(t), good = f.project('Good'), bad = f.project('Bad');
  mkdirSync(join(bad, '.codex'));
  writeFileSync(join(bad, '.codex/config.toml'), '[mcp_servers.localmind]\nurl = "http://localhost:4317/mcp"\n');
  const link = join(f.dir, 'Project link'); symlinkSync(good, link);
  for (const projects of [[], ['relative/project'], [join(f.dir, 'Missing')], [good, good], [homedir()], [parse(good).root], [f.core.dir], [link], [join(bad, '.codex')], [good, bad], Array(33).fill(good)]) {
    assert.equal((await f.request('/preview', { projects })).statusCode, 400);
    assert.equal(existsSync(join(good, '.codex')), false);
  }
  rmSync(join(bad, '.codex/config.toml')); symlinkSync(join(f.dir, 'missing-file'), join(bad, '.codex/config.toml'));
  assert.equal((await f.request('/preview', { projects: [good, bad] })).statusCode, 400);
  rmSync(join(bad, '.codex/config.toml')); symlinkSync(join(good, 'AGENTS.md'), join(bad, 'AGENTS.md'));
  assert.equal((await f.request('/preview', { projects: [good, bad] })).statusCode, 400);
  assert.equal(existsSync(join(good, '.codex')), false);
});

uiTest('shared installer refuses changed files after preparation before applying any file', t => {
  const f = fixture(t), a = f.project('A'), b = f.project('B');
  const options = { url: 'http://127.0.0.1:4317/mcp', tokenFile: join(f.core.dir, 'api-token') };
  const plans = [prepareInstall(a, options), prepareInstall(b, options)];
  writeFileSync(join(b, 'AGENTS.md'), 'Rules changed after review.');
  assert.throws(() => applyInstallPlans(plans), /changed/);
  assert.equal(existsSync(join(a, '.codex')), false);
  assert.equal(readFileSync(join(b, 'AGENTS.md'), 'utf8'), 'Rules changed after review.');
});
