import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readToken } from './codex-headers.mjs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function hashFiles(base, files) {
  const hash = createHash('sha256');
  for (const name of [...files].sort()) hash.update(name).update('\0').update(readFileSync(join(base, name))).update('\0');
  return hash.digest('hex');
}
function sourceFiles(base, relative = 'src') {
  return readdirSync(join(base, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative + '/' + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Source symlinks are not supported by the launcher');
    return entry.isDirectory() ? sourceFiles(base, name) : [name];
  });
}
export function fingerprints(base) {
  const dependencies = hashFiles(base, ['package.json', 'package-lock.json']) + `:${process.platform}:${process.arch}:${process.versions.node.split('.')[0]}`;
  const build = dependencies + ':' + hashFiles(base, ['tsconfig.json', ...sourceFiles(base)]);
  return { dependencies, build };
}
function acquireLock(file) {
  try { writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let pid;
    try { pid = JSON.parse(readFileSync(file, 'utf8')).pid; } catch { throw new Error('Another setup is starting. Retry shortly.'); }
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid setup lock. Review .localmind/prepare.lock.');
    try { process.kill(pid, 0); } catch (check) {
      if (check.code !== 'ESRCH') throw new Error('Another setup is running. Retry after it finishes.');
      unlinkSync(file); return acquireLock(file);
    }
    throw new Error('Another setup is running. Retry after it finishes.');
  }
}
function runNpm(base) {
  // Only fixed npm arguments reach the Windows command shell; paths go through cwd/env.
  const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd ci --ignore-scripts --no-audit --no-fund'] : args;
  const result = spawnSync(command, commandArgs, { cwd: base, stdio: 'inherit', shell: false, env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(base, '.localmind/npm-cache') } });
  if (result.error || result.status !== 0) throw new Error('Dependency installation failed. Check your network connection and retry.');
}
function runBuild(base) {
  const result = spawnSync(process.execPath, [join(base, 'node_modules/typescript/bin/tsc')], { cwd: base, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Application build failed. Review the compiler output and retry.');
}
export function prepare(base = root, { install = runNpm, build = runBuild, report = console.log } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');
  const cache = join(base, '.localmind'); mkdirSync(cache, { recursive: true, mode: 0o700 });
  const lock = join(cache, 'prepare.lock'), stateFile = join(cache, 'prepared.json'); acquireLock(lock);
  try {
    let previous = {};
    try { previous = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* First run or incomplete previous preparation. */ }
    const next = fingerprints(base);
    const dependenciesMissing = !existsSync(join(base, 'node_modules/fastify/package.json')) || !existsSync(join(base, 'node_modules/typescript/bin/tsc'));
    const reinstall = previous.dependencies !== next.dependencies || dependenciesMissing;
    if (reinstall) { report('Installing locked dependencies…'); install(base); }
    const rebuild = reinstall || previous.build !== next.build || !existsSync(join(base, 'dist/src/main.js'));
    if (rebuild) { report('Building LocalMind…'); build(base); }
    const temp = stateFile + '.' + process.pid + '.tmp';
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); renameSync(temp, stateFile);
    report(rebuild ? 'LocalMind is ready.' : 'LocalMind is up to date.');
    return { installed: reinstall, built: rebuild };
  } finally { unlinkSync(lock); }
}
export function settings(base = root) {
  const file = resolve(base, process.env.LOCALMIND_CONFIG ?? 'config.json');
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const port = Number(process.env.LOCALMIND_PORT ?? config.port ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid LocalMind port');
  return { port, dataDir: resolve(base, process.env.LOCALMIND_DATA_DIR ?? config.dataDir ?? 'data'), url: `http://127.0.0.1:${port}` };
}
export function openBrowser(url, platform = process.platform, start = spawn) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid local browser URL');
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = start(command, args, { detached: true, stdio: 'ignore', shell: false });
  child.on('error', () => console.log(`Open ${url} in your browser.`)); child.unref();
}
async function isRunning(config) {
  try {
    const response = await fetch(config.url + '/api/info', { redirect: 'error', signal: AbortSignal.timeout(500), headers: { Authorization: 'Bearer ' + readToken(join(config.dataDir, 'api-token')) } });
    return response.ok && (await response.json()).name === 'LocalMind';
  } catch { return false; }
}
export async function launch({ base = root, browser = true } = {}) {
  const config = settings(base);
  if (await isRunning(config)) { console.log(`LocalMind is already running at ${config.url}`); if (browser) openBrowser(config.url); return 0; }
  const child = spawn(process.execPath, [join(base, 'dist/src/main.js')], { cwd: base, stdio: 'inherit', env: process.env });
  let exited = false;
  const completion = new Promise(resolve => {
    child.once('error', () => { exited = true; resolve(1); });
    child.once('exit', (code, signal) => { exited = true; resolve(code ?? (signal === 'SIGINT' ? 130 : 1)); });
  });
  const interrupt = () => { if (!exited) child.kill('SIGINT'); };
  const terminate = () => { if (!exited) child.kill('SIGTERM'); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !exited; attempt++) {
      if (await isRunning(config)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!ready) { if (!exited) child.kill('SIGTERM'); await completion; throw new Error('LocalMind could not start. Check the port and application logs.'); }
    console.log('Keep this window open. Press Ctrl+C to stop LocalMind.');
    if (browser) openBrowser(config.url);
    return await completion;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { 'prepare-only': { type: 'boolean' }, 'no-open': { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) console.log('Usage: ./start.sh [--no-open | --prepare-only]\nWindows: Start.cmd [--no-open | --prepare-only]\nThe default prepares LocalMind, starts it and opens the browser.');
    else { prepare(); if (!values['prepare-only']) process.exitCode = await launch({ browser: !values['no-open'] }); }
  } catch (error) {
    const safe = error instanceof Error && /^(Another setup|Invalid setup lock|Dependency installation|Application build|Node.js 24|LocalMind could not|Invalid LocalMind port|Source symlinks)/.test(error.message);
    console.error(safe ? error.message : 'LocalMind launch failed. Check local permissions, configuration and network access.'); process.exitCode = 1;
  }
}
