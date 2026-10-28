import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Core } from './core.js';
import { GitSync } from './sync.js';
import { registerMcp } from './mcp.js';
import { InputError, object, text, POLICY } from './security.js';
export function createApp(core: Core, token: string, port = 4317) {
  if (token.length < 32) throw new Error('API token must have at least 32 characters');
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 }); const sync = new GitSync(core);
  let window = Date.now(), calls = 0;
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'").header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store');
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(req.headers.host ?? '')) return reply.code(403).send({ error: 'Invalid host' });
    if (req.headers.origin && !allowed.map(h => 'http://' + h).includes(req.headers.origin)) return reply.code(403).send({ error: 'Invalid origin' });
    if ((req.url.startsWith('/api/') || req.url.startsWith('/mcp')) && req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site access denied' });
    if (Date.now() - window > 60000) { window = Date.now(); calls = 0; }
    if (++calls > 600) return reply.code(429).send({ error: 'Rate limit; retry in one minute' });
    if (req.url.startsWith('/api/') || req.url.startsWith('/mcp')) {
      const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? ''), expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send({ error: 'Bearer token required' });
    }
  });
  app.setErrorHandler((error, _, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : 500;
    const status = error instanceof InputError ? error.statusCode : typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: error instanceof InputError ? error.message : status < 500 ? 'Invalid request' : 'Operation failed' });
  });
  const web = new URL('../../web/', import.meta.url);
  for (const [path, file, mime] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']]) app.get(path, async (_, reply) => reply.type(mime).send(readFileSync(new URL(file, web), 'utf8')));
  app.get('/api/info', async () => ({ name: 'LocalMind', signerId: core.signerId, publicKey: core.identity.publicKey, policy: POLICY }));
  app.get('/api/notes', async () => core.list());
  app.post('/api/notes', async req => core.write(null, req.body, []));
  app.put<{ Params: { id: string } }>('/api/notes/:id', async req => core.write(req.params.id, req.body, object(req.body).expectedHeads));
  app.get<{ Params: { id: string } }>('/api/notes/:id/history', async req => core.history(req.params.id));
  app.post<{ Params: { id: string } }>('/api/notes/:id/resolve', async req => {
    const body = object(req.body); if (body.humanReviewed !== true) throw new InputError('Explicit human review required');
    return core.write(req.params.id, body, body.expectedHeads, true);
  });
  app.get('/api/trusted', async () => core.trusted());
  app.post('/api/trusted', async req => core.trust(text(object(req.body).publicKey, 1000)));
  app.get('/api/sync/plan', async () => sync.plan());
  app.post('/api/sync/plan', async req => sync.plan(text(object(req.body).remote, 1000)));
  app.post('/api/sync/export', async () => sync.export());
  app.post('/api/sync/import', async () => sync.import());
  registerMcp(app, core); return app;
}
