import { mkdirSync, existsSync, lstatSync, chmodSync, openSync, fstatSync, fchmodSync, writeSync, closeSync, renameSync, unlinkSync, constants } from 'node:fs';
import { join } from 'node:path';
export type LogEvent = 'app.started' | 'app.stopped' | 'app.failed' | 'http.completed' | 'mcp.completed' | 'mcp.rejected';
export type LogFields = { method?: string; route?: string; status?: number; durationMs?: number; port?: number; tool?: string; rpc?: string };
export type AppLog = (event: LogEvent, fields?: LogFields) => void;
export const silentLog: AppLog = () => {};
const routes = new Set(['/api/info', '/api/notes', '/api/notes/:id', '/api/notes/:id/history', '/api/notes/:id/resolve', '/api/trusted', '/api/sync/plan', '/api/sync/export', '/api/sync/import', '/api/integrations/codex', '/api/integrations/codex/preview', '/api/integrations/codex/connect', '/mcp']);
const tools = new Set(['agent_policy', 'list_notes', 'note_history', 'create_note', 'update_note']);
const rpcs = new Set(['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read']);
export function createLogger(dataDir: string, { maxBytes = 1024 * 1024, output = (line: string) => process.stdout.write(line) } = {}): { log: AppLog; file: string } {
  const directory = join(dataDir, 'logs');
  if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())) throw new Error('Unsafe log directory');
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const file = join(directory, 'localmind.log');
  if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw new Error('Unsafe log file');
  let warned = false;
  const log: AppLog = (event, fields = {}) => {
    // Copy only explicitly allowed metadata. Never serialize input, error objects, headers or note content.
    const safe: Record<string, string | number> = {};
    if (fields.method && ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(fields.method)) safe.method = fields.method;
    if (fields.route) safe.route = routes.has(fields.route) ? fields.route : 'unmatched';
    if (fields.tool) safe.tool = tools.has(fields.tool) ? fields.tool : 'unknown';
    if (fields.rpc) safe.rpc = rpcs.has(fields.rpc) ? fields.rpc : 'unknown';
    for (const name of ['status', 'durationMs', 'port'] as const) if (typeof fields[name] === 'number' && Number.isFinite(fields[name])) safe[name] = Math.max(0, Math.round(fields[name]!));
    const level = event.endsWith('failed') || event.endsWith('rejected') || (fields.status ?? 0) >= 400 ? 'error' : 'info';
    const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...safe }) + '\n';
    output(line);
    try {
      if (existsSync(file) && lstatSync(file).size + Buffer.byteLength(line) > maxBytes) {
        if (existsSync(file + '.3')) unlinkSync(file + '.3');
        for (let i = 2; i >= 1; i--) if (existsSync(file + '.' + i)) renameSync(file + '.' + i, file + '.' + (i + 1));
        renameSync(file, file + '.1');
      }
      const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { if (!fstatSync(fd).isFile()) throw new Error('Unsafe log destination'); fchmodSync(fd, 0o600); writeSync(fd, line); }
      finally { closeSync(fd); }
    } catch { if (!warned) { warned = true; process.stderr.write('LocalMind could not write the application log. Check local permissions.\n'); } }
  };
  return { log, file };
}
