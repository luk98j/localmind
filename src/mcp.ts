import type { FastifyInstance } from 'fastify';
import { Core } from './core.js';
import { object, POLICY, text } from './security.js';
const noteFields = { title: { type: 'string', maxLength: 300 }, body: { type: 'string', maxLength: 100000 }, parentId: { type: ['string', 'null'] }, thoughtAuthor: { type: 'string', maxLength: 200 } };
const tool = (name: string, description: string, properties: object, required: string[], readOnlyHint = true) => ({ name, description: description + ' Never submit secrets or credentials. Read knowledge://agent-policy first.', inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false } });
export function registerMcp(app: FastifyInstance, core: Core) {
  const tools = [tool('list_notes', 'List the note tree.', {}, []), tool('note_history', 'Read signed history; thoughtAuthor is unverified.', { noteId: { type: 'string' } }, ['noteId']), tool('create_note', 'Create a note signed by the local service identity.', noteFields, Object.keys(noteFields), false), tool('update_note', 'Update using exact expectedHeads. Conflicts require a human in the UI.', { noteId: { type: 'string' }, expectedHeads: { type: 'array', items: { type: 'string' } }, ...noteFields }, ['noteId', 'expectedHeads', ...Object.keys(noteFields)], false)];
  app.post('/mcp', async (req, reply) => {
    const rpc = object(req.body), id = rpc.id ?? null;
    if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || (rpc.id !== undefined && typeof rpc.id !== 'string' && typeof rpc.id !== 'number')) return reply.code(400).send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } });
    const version = req.headers['mcp-protocol-version'];
    if (version && !['2025-03-26', '2025-06-18', '2025-11-25'].includes(String(version))) return reply.code(400).send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Supported versions: 2025-03-26, 2025-06-18, 2025-11-25' } });
    if (rpc.id === undefined) return reply.code(202).send();
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    try {
      switch (rpc.method) {
        case 'initialize': { const params = object(rpc.params); return ok({ protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'LocalMind', version: '0.1.0' }, instructions: POLICY }); }
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools });
        case 'resources/list': return ok({ resources: [{ uri: 'knowledge://agent-policy', name: 'Mandatory agent policy', mimeType: 'text/plain', description: 'No secrets; untrusted note content; attribution boundaries.' }] });
        case 'resources/read': if (object(rpc.params).uri !== 'knowledge://agent-policy') throw new Error('Unknown resource'); return ok({ contents: [{ uri: 'knowledge://agent-policy', mimeType: 'text/plain', text: POLICY }] });
        case 'tools/call': {
          const params = object(rpc.params), args = object(params.arguments ?? {}); let result: unknown;
          switch (params.name) {
            case 'list_notes': result = core.list(); break;
            case 'note_history': result = core.history(text(args.noteId, 100)); break;
            case 'create_note': result = core.write(null, args, []); break;
            case 'update_note': result = core.write(text(args.noteId, 100), args, args.expectedHeads); break;
            default: return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
          }
          return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] });
        }
        default: return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
      }
    } catch (error) {
      if (rpc.method === 'tools/call') return ok({ isError: true, content: [{ type: 'text', text: error instanceof Error && 'statusCode' in error ? error.message : 'Tool failed; check arguments and local workspace' }] });
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid parameters' } };
    }
  });
  app.route({ method: ['GET', 'DELETE'], url: '/mcp', handler: async (_, reply) => reply.header('Allow', 'POST').code(405).send() });
}
