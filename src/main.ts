import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Core } from './core.js';
import { createApp } from './server.js';
import { createLogger } from './logging.js';
async function main() {
  const configPath = process.env.LOCALMIND_CONFIG ?? 'config.json';
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const port = Number(process.env.LOCALMIND_PORT ?? config.port ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const dataDir = resolve(process.env.LOCALMIND_DATA_DIR ?? config.dataDir ?? 'data');
  const { log, file: logFile } = createLogger(dataDir);
  let core: Core | undefined, app: ReturnType<typeof createApp> | undefined, stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    if (app) await app.close(); if (core) core.close(); log('app.stopped');
  };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  try {
    core = new Core(dataDir);
    const tokenPath = join(core.dir, 'api-token');
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    chmodSync(tokenPath, 0o600);
    app = createApp(core, readFileSync(tokenPath, 'utf8').trim(), port, log);
    await app.listen({ host: '127.0.0.1', port });
    log('app.started', { port });
    console.log(`LocalMind: http://127.0.0.1:${port}\nRead the local API token from ${tokenPath}. Never store it in notes.\nApplication log: ${logFile}`);
  } catch {
    log('app.failed', { port }); await stop();
    console.error('Cannot start LocalMind. Check the port, permissions and application log.'); process.exitCode = 1;
  }

}
void main().catch(() => {
  console.error('LocalMind could not initialize. Check local configuration, paths and permissions.');
  process.exitCode = 1;
});
