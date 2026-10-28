# LocalMind

A lightweight local knowledge notebook for people and coding agents. One Node.js process serves a Fastify HTTP API, a web note tree, and a local MCP endpoint. SQLite holds an append-only log of signed events with encrypted content. No Docker, cloud account, frontend build system, ORM, or external database is required.

**MVP, not an audited enterprise security product. Never store passwords or secrets in notes.**

## One-command start

On macOS or Linux, open a terminal in the downloaded/cloned LocalMind folder and run:

```sh
./start.sh
```

If an archive extractor did not preserve executable permissions, `bash start.sh` is an equivalent one-command start. On macOS, you can also double-click `LocalMind.command` in Finder. On Windows, double-click `Start.cmd`, or run it from the project folder:

```bat
Start.cmd
```

The launcher uses your existing Node.js 24+ and npm when available. Otherwise, it downloads a private copy of the official Node.js runtime into `.localmind/runtime/` and verifies the archive against a SHA-256 checksum committed with the application **before extraction and execution**. No administrator access, system Node installation, Docker or machine-wide execution-policy change is needed. First preparation needs internet access to Node.js and the npm registry. The portable downloads cover macOS, glibc-based Linux and 64-bit Windows on x64/ARM64.

On first run, the launcher installs locked dependencies with lifecycle scripts disabled, builds the application, starts the local server and opens your browser. Later runs reuse prepared dependencies and build output until the relevant files change. Notebook data and logs are excluded from preparation fingerprints and are never uploaded by the launcher. The `.localmind/` cache stays out of Git.

Open <http://127.0.0.1:4317> if the browser does not open automatically. The login screen still requires your local API token from `data/api-token`; the launcher does not put credentials in browser URLs, configuration or console output. Keep the launcher window open and use **Ctrl+C** to stop the server. Closing a browser tab does not stop the application. If this same notebook is already running on the configured port, the launcher opens the existing instance. Stop the running server before restarting after a source update so it loads the new code. This feature does not install a login item or start the application when your computer boots.

For a server without automatic browser opening, use `./start.sh --no-open` or `Start.cmd --no-open`. Use `--prepare-only` to install/build without creating or starting a notebook. On a later run with unchanged dependencies and a cached runtime, preparation does not require a download. If you move the application again, rerun Codex setup to refresh its absolute paths.

## Manual terminal start

The original development workflow remains supported. It requires Node.js 24+ and npm already installed:

```sh
npm ci
npm run build
npm start
```

Run `npm test` for the full test suite. Node's built-in `node:sqlite` may print an experimental-feature warning on some supported releases.

Copy `config.example.json` to `config.json` to change the port or data directory. Configuration is optional. `LOCALMIND_CONFIG`, `LOCALMIND_PORT` and `LOCALMIND_DATA_DIR` override defaults. Paths are relative to the project directory for the launcher, and to the launch directory for `npm start`. Binding is always IPv4 loopback (`127.0.0.1`); exposing the application through a proxy is outside this MVP's scope.

## Application logs

The terminal displays application events automatically. The same JSON-lines diagnostics are saved to **`data/logs/localmind.log`**, or `logs/localmind.log` inside your configured data directory. The application prints the exact location at startup. Logs cover application start/stop and startup failure, API/MCP request outcomes, rejected MCP calls, HTTP status, route templates and durations.

Log fields are allowlisted: **no note titles/bodies, declared authors, token values, Authorization headers, query strings, request bodies, arbitrary error objects or stack traces are written to application logs**. Unrecognized method/tool/route values become generic labels. Files use owner-only permissions on POSIX; Windows access protection follows your user-directory ACLs.

A log rotates at approximately 1 MiB. The application retains the active file and up to three archives (`.1`, `.2`, `.3`). These diagnostic files are separate from the signed event history and are excluded from Git. If file logging becomes unavailable, the console reports a generic warning and continues displaying events.

For troubleshooting, first read the terminal and the last entries in the log. Share only reviewed, redacted diagnostics; never share the API token, identity file, complete database or notebook contents. Dependency installation and compiler diagnostics are displayed by npm/TypeScript in the launcher terminal; they are not copied into the application log.

## Launcher maintenance

The portable runtime version is pinned in `scripts/node-version`; archive hashes are in `scripts/node-shasums.txt`, sourced from the official [Node.js release checksums](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt). Runtime upgrades require updating the version and checksums together and rerunning platform verification. `LOCALMIND_PORTABLE_NODE=1` forces the portable runtime path for maintenance/testing. The launcher downloads executable archives, never a remote shell script. It does not install Git, configure a remote, synchronize notebooks or change Codex settings automatically.

These are optional source-folder launchers, not signed native `.dmg`/`.msi` installers. Native packaging can be added separately while keeping both the one-command launcher and normal npm workflow.

## Features

- Create, edit and move plain-text notes in a parent/child tree. Circular paths are rejected.
- Every change appends a complete encrypted note revision. Previous revisions remain available in the signed history.
- Ed25519 signatures identify the local service key. `thoughtAuthor` separately records **unverified declared attribution**. The signing key proves possession of a key, not the real-world identity of the person, agent, or original thinker.
- Optimistic concurrency requires exact `expectedHeads`; stale writes receive HTTP 409.
- Independently imported branches of the same note become a conflict. A human compares the head versions in the UI, edits the final text and confirms review. A new resolution event references all heads; no history is overwritten.
- Independent note changes import automatically. Invalid signatures, unknown keys, missing parents, cycles, damaged encryption and event ID collisions reject the entire import.
- Git sync skeleton exports/imports encrypted JSON event files. It makes **no network calls** and cannot clone, fetch, add remotes or push.
- Agents receive a no-secrets policy during MCP initialization, in every tool description, through a policy resource, and in [AGENTS.md](AGENTS.md). HTTP and MCP share the same pre-write secret detector.

## Codex integration

Run `npm run codex:setup -- --project /absolute/path/to/your-project` to install a project-local MCP configuration and agent rules. The local credential helper reads the API token directly for Codex; no token is copied into configuration. With LocalMind running, `npm run codex:setup -- --check` verifies the handshake and policy without reading or changing notes. See [the Codex setup guide](integrations/codex/README.md) for desktop, CLI, trust, authentication and removal instructions.

## Agent integration (MCP)

Endpoint: `http://127.0.0.1:4317/mcp`. Use a client that supports Streamable HTTP and custom `Authorization: Bearer <local token>` headers. Configure the token through your client's protected credential configuration; never commit it. The service runs in the same process as HTTP; no second stdio server is needed.

This MVP implements the JSON-response, stateless subset of the **2025-03-26, 2025-06-18 and 2025-11-25** protocol revisions: `initialize`, initialized notifications, `ping`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`. It does not claim the newer 2026 protocol, streaming, subscriptions or server-to-client sampling support. GET and DELETE return 405. Send `Accept: application/json, text/event-stream` and the negotiated `MCP-Protocol-Version` header after initialization.

Tools: `agent_policy`, `list_notes`, `note_history`, `create_note`, `update_note`. Read `knowledge://agent-policy` before working. The policy is also returned in `initialize.instructions`. Agent clients must arrange policy loading; LocalMind cannot force an arbitrary model to follow instructions.

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
