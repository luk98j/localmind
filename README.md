# LocalMind

A lightweight local knowledge notebook for people and coding agents. One Node.js process serves a Fastify HTTP API, a web note tree, and a local MCP endpoint. SQLite holds an append-only log of signed events with encrypted content. No Docker, cloud account, frontend build system, ORM, or external database is required.

**MVP, not an audited enterprise security product. Never store passwords or secrets in notes.**

## Quick start

Requires Node.js 24 or newer and npm. Node's built-in `node:sqlite` may print an experimental-feature warning on some supported releases.

```sh
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4317>. Read the token from `data/api-token` and paste it into the login form. The browser holds it in memory only; reloading requires unlocking again. Never copy the token into a note, issue, screenshot, or repository.

```sh
npm test
```

Copy `config.example.json` to `config.json` to change the port or data directory. Configuration is optional. `LOCALMIND_CONFIG`, `LOCALMIND_PORT` and `LOCALMIND_DATA_DIR` override defaults. Paths are relative to the launch directory. Binding is always IPv4 loopback (`127.0.0.1`); exposing the application through a proxy is outside this MVP's scope. Run the commands from the project root.

## Features

- Create, edit and move plain-text notes in a parent/child tree. Circular paths are rejected.
- Every change appends a complete encrypted note revision. Previous revisions remain available in the signed history.
- Ed25519 signatures identify the local service key. `thoughtAuthor` separately records **unverified declared attribution**. The signing key proves possession of a key, not the real-world identity of the person, agent, or original thinker.
- Optimistic concurrency requires exact `expectedHeads`; stale writes receive HTTP 409.
- Independently imported branches of the same note become a conflict. A human compares the head versions in the UI, edits the final text and confirms review. A new resolution event references all heads; no history is overwritten.
- Independent note changes import automatically. Invalid signatures, unknown keys, missing parents, cycles, damaged encryption and event ID collisions reject the entire import.
- Git sync skeleton exports/imports encrypted JSON event files. It makes **no network calls** and cannot clone, fetch, add remotes or push.
- Agents receive a no-secrets policy during MCP initialization, in every tool description, through a policy resource, and in [AGENTS.md](AGENTS.md). HTTP and MCP share the same pre-write secret detector.

## Agent integration (MCP)

Endpoint: `http://127.0.0.1:4317/mcp`. Use a client that supports Streamable HTTP and custom `Authorization: Bearer <local token>` headers. Configure the token through your client's protected credential configuration; never commit it. The service runs in the same process as HTTP; no second stdio server is needed.

This MVP implements the JSON-response, stateless subset of the **2025-03-26, 2025-06-18 and 2025-11-25** protocol revisions: `initialize`, initialized notifications, `ping`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`. It does not claim the newer 2026 protocol, streaming, subscriptions or server-to-client sampling support. GET and DELETE return 405. Send `Accept: application/json, text/event-stream` and the negotiated `MCP-Protocol-Version` header after initialization.

Tools: `list_notes`, `note_history`, `create_note`, `update_note`. Read `knowledge://agent-policy` before working. The policy is also returned in `initialize.instructions`. Agent clients must arrange policy loading; LocalMind cannot force an arbitrary model to follow instructions.

Required create fields: `title`, `body`, `parentId` (`null` for root), `thoughtAuthor` (empty string allowed). Updates additionally require `noteId` and the exact array of `expectedHeads` returned by `list_notes`. MCP intentionally provides no conflict-resolution, trust-management or Git tool.

All MCP calls are signed by the running service identity. Separate identities per requesting agent, fine-grained permissions, and verified human identity are future work.

## HTTP API

All `/api/*` and `/mcp` requests require the bearer token. The UI assets are public on loopback and contain no workspace data. Requests with an unexpected Host or Origin are rejected; cross-site Fetch Metadata is additionally rejected for protected API/MCP calls. Navigation to the public login page is allowed. No CORS access is granted. Request bodies are limited to 1 MiB and the process accepts at most 600 requests per minute.

| Method and path | Purpose |
| --- | --- |
| `GET /api/info` | Public signing key, signer fingerprint and policy (requires token) |
| `GET /api/notes` | Tree projection and current heads |
| `POST /api/notes` | Create a note |
| `PUT /api/notes/:id` | Append a revision, with `expectedHeads` |
| `GET /api/notes/:id/history` | Full decrypted history with signatures and attribution |
| `POST /api/notes/:id/resolve` | Append resolution with exact `expectedHeads` and `humanReviewed: true` |
| `GET /api/trusted` | Explicitly trusted signing keys |
| `POST /api/trusted` | Trust an Ed25519 PEM `publicKey` after out-of-band verification |
| `GET /api/sync/plan` | Read the disabled-network sync plan |
| `POST /api/sync/plan` | Validate a proposed HTTPS GitHub/Bitbucket `remote`; does not persist or connect it |
| `POST /api/sync/export` | Export signed encrypted events to `data/exchange/` |
| `POST /api/sync/import` | Atomically validate and import events from `data/exchange/` |

The resolve endpoint records a human-review attestation, not cryptographic proof of human presence. A holder of the full local token can call it directly. Do not distribute this token to untrusted agents.

## Storage, cryptography and trust

`data/core.sqlite` is the source of truth. The `events` table stores immutable signed envelopes, protected against UPDATE and DELETE by SQLite triggers. These are application integrity controls, not protection against an administrator replacing the database. The note tree is rebuilt and verified from events, including on startup. The MVP has no persisted plaintext search index. Reads decrypt and replay history synchronously, suitable for a small notebook rather than a large shared deployment.

Each event has a UUID, note UUID, parent event IDs, timestamp, signer fingerprint, an encrypted payload, and an Ed25519 signature. Each payload contains the full note including the title and declared thought author. AES-256-GCM uses a fresh random 96-bit IV and 128-bit authentication tag. Canonically encoded event metadata is authenticated as associated data. The signature covers metadata plus ciphertext. The SHA-256 fingerprint of the canonical exported PEM public key identifies its signer.

Parent references form a DAG per note, **not a global timestamp-ordered chain**. Imported input is topologically ordered; wall-clock time is informational. All branch heads remain available. The current conflicted tree uses the last replayed revision only as a preview, never a conflict decision. Concurrent hierarchy changes that would form a tree cycle are rejected atomically and require manual correction on the source before import. No semantic text merge is attempted.

`data/identity.json` holds the private signing key, public key and a random workspace encryption key. `data/api-token` holds a separate random API token. The directory uses mode 0700 and sensitive files use 0600 on POSIX. **The encryption key is stored locally alongside the database; encryption protects exchanged files, not a compromised/unlocked machine or someone who can read the data directory.** Use OS full-disk encryption and trusted device accounts. There is no passphrase lock, keychain integration, key rotation, key revocation or multi-user key distribution in this MVP. Windows requires equivalent directory ACLs managed by the user.

Back up the entire data directory securely while the process is stopped (or use a SQLite-aware backup). Losing `identity.json` means losing decryption access. Do not copy it into a repository. Do not share private signing identities between collaborators. A future device onboarding flow must transfer only the shared workspace encryption key over a separately secured channel and explicitly trust public fingerprints; no automated onboarding is provided yet.

Exported events expose note IDs, parent links, signer IDs and timestamps. They do not contain note text, private keys or the encryption key. Signatures cannot prove that history is complete, prevent rollback to an earlier valid database, or establish human identity.

## No-secrets policy

Never put credentials in any notebook field, including titles and attribution. Encryption does not change this rule. Store secrets in a password manager; refer only to a generic entry name.

The detector rejects common labeled password/token assignments, private key headers, known token formats, bearer tokens and credential-bearing URLs **before encryption and persistence**. It scans HTTP writes, MCP writes, and decrypted imported content. Error messages do not repeat rejected content. This heuristic has false positives and false negatives; ordinary words, obfuscated credentials, arbitrary high-entropy strings and all provider formats cannot be detected reliably. Policies and human judgment remain necessary. The application has no secret-scanning bypass.

History is append-only: editing a note cannot erase an accidentally accepted secret from earlier revisions. If this happens, stop synchronizing, revoke the secret, and handle repository/history remediation through a separate reviewed incident procedure. Do not paste the secret into a bug report.

## GitHub / Bitbucket sync skeleton

The application has no Git credentials and never calls Git or a remote. This boundary is intentional. App sync configuration cannot enable network access in this version.

1. Export through the web UI or API. Files appear in the fixed `data/exchange/` directory as `<event-id>.json`.
2. In a **separate, dedicated repository**, manually review and copy only those event JSON files. Never commit the application data directory, identity file, database or token. Private repository visibility is strongly recommended for real notebook event metadata.
3. Add or contact a GitHub/Bitbucket remote only after explicit authorization and using credentials managed outside the notebook. Review the diff before a manual commit or push. Do not merge an event JSON file's contents: each event is an immutable unit.
4. Copy received event files to the fixed exchange directory, explicitly trust verified public signing keys, then import. A replica must already have the same workspace encryption key from a secure out-of-band setup. No key is fetched from Git or trusted because it was present in Git.
5. Resolve same-note branches in the UI. Export the new resolution event and review it before the next manual Git operation.

Import rejects symlinks, unexpected file names, oversized files, more than 5,000 files or more than 20 MB per batch. Export refuses to overwrite a different existing event file. Operation assumes a trusted local filesystem; it is not hardened against a malicious local process racing filesystem operations.

Publishing **this source code** as an open-source project is separate from synchronizing notebook data. This repository excludes runtime data by default.

## Development and verification

Only Fastify is a direct runtime dependency. TypeScript and Node types are development dependencies. SQLite, cryptography, file access and the test runner are built into Node.

`npm test` compiles TypeScript and runs isolated temporary-workspace integration tests for persistence, signatures, encryption tampering, append-only SQL controls, secret rejection, concurrent branches, human resolution, trust, atomic import, Git exchange, HTTP protections and MCP requests. Tests do not contact GitHub or Bitbucket. `npm run dev` is a build-and-start convenience command; there is no hot reload.

Specifications: [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [Fastify server reference](https://fastify.dev/docs/latest/Reference/Server/), and [MCP 2025-11-25 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Deliberate MVP limits

No deletion, attachments, rich-text rendering, full-text search, automatic Git networking, background jobs, enterprise authentication or audited security claims. The plain-text UI renders user content through DOM text APIs, not HTML. Large-history indexing, per-agent capabilities, safe device onboarding, credential vault integration and a reviewed network sync adapter are possible follow-up work.
