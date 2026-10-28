import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, randomBytes, randomUUID, sign, verify, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, hash, encrypt, decrypt, noSecrets, object, text, InputError, ConflictError, type Envelope } from './security.js';
export type Note = { title: string; body: string; parentId: string | null; thoughtAuthor: string };
export type Event = { version: 1; id: string; noteId: string; parents: string[]; timestamp: string; signerId: string; payload: Envelope; signature: string };
type Identity = { publicKey: string; privateKey: string; key: string };
export class Core {
  db: DatabaseSync; identity: Identity; key: Buffer; signerId: string;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const identityPath = join(dir, 'identity.json');
    if (!existsSync(identityPath)) {
      const pair = generateKeyPairSync('ed25519');
      writeFileSync(identityPath, JSON.stringify({ publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), key: randomBytes(32).toString('base64') }), { mode: 0o600, flag: 'wx' });
    }
    chmodSync(identityPath, 0o600);
    this.identity = JSON.parse(readFileSync(identityPath, 'utf8')); this.key = Buffer.from(this.identity.key, 'base64');
    this.signerId = hash(this.identity.publicKey);
    this.db = new DatabaseSync(join(dir, 'core.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trusted (id TEXT PRIMARY KEY, public_key TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS no_event_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
      CREATE TRIGGER IF NOT EXISTS no_event_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;`);
    this.db.prepare('INSERT OR IGNORE INTO trusted VALUES (?,?)').run(this.signerId, this.identity.publicKey);
    // Verify persisted history before serving any data.
    this.materialize(this.events());
  }
  events(): Event[] { return this.db.prepare('SELECT document FROM events ORDER BY rowid').all().map(r => JSON.parse(r.document as string)); }
  trusted() { return this.db.prepare('SELECT id, public_key AS publicKey FROM trusted').all(); }
  trust(publicKey: string) {
    const key = createPublicKey(text(publicKey, 1000));
    if (key.asymmetricKeyType !== 'ed25519') throw new InputError('Only Ed25519 keys are accepted');
    const normalized = key.export({ type: 'spki', format: 'pem' }).toString(), id = hash(normalized);
    this.db.prepare('INSERT OR IGNORE INTO trusted VALUES (?,?)').run(id, normalized); return { signerId: id };
  }
  aad(e: Omit<Event, 'signature' | 'payload'>) { return canonical(e); }
  decode(e: Event): Note {
    if (Object.keys(e).sort().join(',') !== 'id,noteId,parents,payload,signature,signerId,timestamp,version' || typeof e.signature !== 'string' || e.signature.length > 200 || typeof e.signerId !== 'string' || typeof e.id !== 'string' || typeof e.noteId !== 'string' || typeof e.timestamp !== 'string') throw new InputError('Invalid event fields');
    const { signature, payload, ...header } = e;
    const box = object(payload);
    if (Object.keys(box).sort().join(',') !== 'data,iv,tag' || typeof box.data !== 'string' || box.data.length > 450000 || typeof box.iv !== 'string' || Buffer.from(box.iv, 'base64').length !== 12 || typeof box.tag !== 'string' || Buffer.from(box.tag, 'base64').length !== 16) throw new InputError('Invalid encryption envelope');
    noSecrets(header);
    if (e.version !== 1 || !/^[a-zA-Z0-9-]{1,100}$/.test(e.id) || !/^[a-zA-Z0-9-]{1,100}$/.test(e.noteId) || !Array.isArray(e.parents) || e.parents.length > 20 || e.parents.some(p => typeof p !== 'string') || !Number.isFinite(Date.parse(e.timestamp))) throw new InputError('Invalid event');
    const trusted = this.db.prepare('SELECT public_key FROM trusted WHERE id=?').get(e.signerId);
    if (!trusted || !verify(null, Buffer.from(canonical({ ...header, payload })), trusted.public_key as string, Buffer.from(signature, 'base64'))) throw new InputError('Untrusted signer or invalid event signature');
    let result: unknown;
    try { result = decrypt(payload, this.key, this.aad(header)); } catch { throw new InputError('Cannot decrypt event: wrong workspace key or damaged ciphertext'); }
    return this.validateNote(result);
  }
  validateNote(value: unknown): Note {
    const n = object(value); noSecrets(n);
    const note = { title: text(n.title, 300).trim(), body: text(n.body, 100000), parentId: n.parentId === null ? null : text(n.parentId, 100), thoughtAuthor: text(n.thoughtAuthor, 200) };
    if (!note.title || (note.parentId !== null && !/^[a-zA-Z0-9-]{1,100}$/.test(note.parentId))) throw new InputError('Invalid title or parent');
    return note;
  }
  materialize(events: Event[]) {
    const known = new Map<string, Event>(), notes = new Map<string, Note>(), heads = new Map<string, Set<string>>();
    for (const e of events) {
      if (known.has(e.id)) throw new InputError('Duplicate event');
      const note = this.decode(e);
      if (new Set(e.parents).size !== e.parents.length || e.parents.some(p => known.get(p)?.noteId !== e.noteId)) throw new InputError('Missing or invalid event parent');
      if (note.parentId && !notes.has(note.parentId)) throw new InputError('Missing note parent');
      let p = note.parentId; const seen = new Set([e.noteId]);
      while (p) { if (seen.has(p)) throw new InputError('Tree cycle'); seen.add(p); p = notes.get(p)?.parentId ?? null; }
      known.set(e.id, e); notes.set(e.noteId, note);
      const h = heads.get(e.noteId) ?? new Set<string>(); e.parents.forEach(x => h.delete(x)); h.add(e.id); heads.set(e.noteId, h);
    }
    return { known, notes, heads };
  }
  list() {
    const state = this.materialize(this.events());
    return [...state.notes].map(([id, note]) => { const heads = [...state.heads.get(id)!]; return { id, ...note, heads, conflicted: heads.length > 1 }; });
  }
  history(noteId: string) { return this.events().filter(e => e.noteId === noteId).map(e => ({ ...e, content: this.decode(e) })); }
  write(noteId: string | null, value: unknown, expectedHeads: unknown, resolve = false) {
    const note = this.validateNote(value), state = this.materialize(this.events());
    const id = noteId ?? randomUUID(), heads = [...(state.heads.get(id) ?? [])];
    if (noteId && !heads.length) throw new InputError('Unknown note');
    if (!Array.isArray(expectedHeads) || canonical([...expectedHeads].sort()) !== canonical([...heads].sort())) throw new ConflictError('Stale version; reload before saving');
    if (heads.length > 1 && !resolve) throw new ConflictError('Human conflict resolution required');
    const header = { version: 1 as const, id: randomUUID(), noteId: id, parents: heads, timestamp: new Date().toISOString(), signerId: this.signerId };
    const unsigned = { ...header, payload: encrypt(note, this.key, this.aad(header)) };
    const event = { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), this.identity.privateKey).toString('base64') };
    this.materialize([...this.events(), event]);
    this.db.prepare('INSERT INTO events VALUES (?,?)').run(event.id, canonical(event)); return { noteId: id, eventId: event.id };
  }
  import(input: unknown) {
    if (!Array.isArray(input) || input.length > 5000) throw new InputError('Expected at most 5000 events');
    const all = this.events(), existing = new Map(all.map(e => [e.id, canonical(e)]));
    const pending: Event[] = [];
    for (const raw of input) {
      const e = object(raw) as Event;
      if (existing.has(e.id)) { if (existing.get(e.id) !== canonical(e)) throw new InputError('Event ID collision'); continue; }
      this.decode(e); existing.set(e.id, canonical(e)); pending.push(e);
    }
    // Accept arbitrary file order, but require a complete DAG and validate atomically.
    const ordered = [...all], ids = new Set(all.map(e => e.id));
    while (pending.length) {
      const index = pending.findIndex(e => e.parents.every(p => ids.has(p)) && (!this.decode(e).parentId || ordered.some(p => p.noteId === this.decode(e).parentId)));
      if (index < 0) throw new InputError('Incomplete or cyclic event graph');
      const [e] = pending.splice(index, 1); ordered.push(e); ids.add(e.id);
    }
    this.materialize(ordered);
    this.db.exec('BEGIN IMMEDIATE');
    try { for (const e of ordered.slice(all.length)) this.db.prepare('INSERT INTO events VALUES (?,?)').run(e.id, canonical(e)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { imported: ordered.length - all.length, conflicts: this.list().filter(n => n.conflicted).map(n => n.id) };
  }
  close() { this.key.fill(0); this.db.close(); }
}
