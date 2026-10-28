import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Core } from './core.js';
import { createApp } from './server.js';
const configPath = process.env.LOCALMIND_CONFIG ?? 'config.json';
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const port = Number(process.env.LOCALMIND_PORT ?? config.port ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const core = new Core(resolve(process.env.LOCALMIND_DATA_DIR ?? config.dataDir ?? 'data'));
const tokenPath = join(core.dir, 'api-token');
if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
chmodSync(tokenPath, 0o600);
const app = createApp(core, readFileSync(tokenPath, 'utf8').trim(), port);
const stop = async () => { await app.close(); core.close(); };
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
try { await app.listen({ host: '127.0.0.1', port }); console.log(`LocalMind: http://127.0.0.1:${port}\nRead the local API token from ${tokenPath}. Never store it in notes.`); }
catch { await stop(); console.error('Cannot start LocalMind. Check the port and local configuration.'); process.exitCode = 1; }
