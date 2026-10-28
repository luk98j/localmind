# Codex integration

LocalMind connects to local Codex clients through Streamable HTTP MCP. This integration adds no runtime dependency and does not call a model API. It supplies a project configuration, agent instructions, a credential helper and a read-only connection check.

## Recommended setup (macOS / Linux)

1. In the LocalMind repository, install and build the application, then keep it running:

   ```sh
   npm ci
   npm run build
   npm start
   ```

2. In another terminal, install the integration for the project where you want Codex to use LocalMind:

   ```sh
   npm run codex:setup -- --project /absolute/path/to/your-project
   npm run codex:setup -- --check
   ```

   For LocalMind's own source project, use `--project .`. Without `--project` or `--check`, the command only prints the proposed configuration, without credentials. To use a different notebook, pass `--url http://127.0.0.1:PORT/mcp --token-file /absolute/path/to/api-token` to both commands. `LOCALMIND_CONFIG`, `LOCALMIND_DATA_DIR` and `LOCALMIND_PORT` are respected; run from the LocalMind root when using relative configuration paths, as with `npm start`.

3. Open that project in Codex and trust it through the normal project trust flow if requested. Open a new local Codex session so it loads `.codex/config.toml` and the project's `AGENTS.md`. An already-running conversation does not gain callable tools simply because the files changed.

4. Ask Codex to read LocalMind's policy and list the notes. In the CLI, `/mcp` shows active MCP servers. `codex mcp get localmind` shows the registered project configuration when the project is trusted. Do not paste credential-helper output into the conversation.

The installer edits only the selected project's `.codex/config.toml` and `AGENTS.md`. It preserves existing content and updates its own marked blocks on repeated runs. It refuses recognizable unmanaged duplicate definitions, malformed markers and symlinked target files. Unusual TOML layouts should be merged manually; this is not a general TOML editor. Review the diff before committing instructions. Installation does not mark a project trusted, change global Codex settings, start LocalMind, or change sandbox permissions.

The generated config contains absolute machine-local paths and should be excluded from version control. LocalMind's own `.gitignore` already excludes it. In another project, add `/.codex/config.toml` to that project's ignore rules or keep it in a local Git exclude file. The generated block itself contains no token, but may coexist with other private settings in that file. Do not publish the whole file.

## Authentication without copying credentials

Codex executes `http_headers_helper` locally to obtain the Authorization header. The helper reads LocalMind's owner-only `data/api-token` and writes the header JSON directly to Codex. The token is not in the TOML, a command-line argument, the model context, a note or a committed file. The helper refuses malformed, oversized, symlinked or group/world-readable token files on POSIX and emits only a generic error on failure.

**Do not run the credential helper manually in a chat, captured terminal or CI log.** Its successful stdout is a credential. Configure it only for a trusted local client. If the repository or Node executable is moved, rerun setup so the generated absolute paths are updated. LocalMind must be running before Codex connects; changing the token file requires restarting LocalMind because the application loads its API token on startup.

The helper configuration restricts the endpoint to plain HTTP loopback and does not allow credentials in URLs. The connection checker refuses redirects, validates the handshake, lists tool metadata and reads the mandatory policy. It does not read, create or modify notes, print note contents, or reveal authentication headers.

## Agent behavior

Codex receives the server-wide no-secrets policy in MCP initialization, tool descriptions, the `knowledge://agent-policy` resource, and the `agent_policy` tool. The installer adds project instructions that require policy reading and treat note contents as untrusted data. All sensitive guidance is in the opening portion of the server instructions, before supplementary workflow details.

Available tools:

- `agent_policy`: mandatory rules, without reading notes.
- `list_notes`: the note tree and revision heads.
- `note_history`: signed history and unverified thought attribution.
- `create_note`: append a new note revision.
- `update_note`: append using exact `expectedHeads`.

`default_tools_approval_mode = "writes"` lets Codex request confirmation for tools not marked read-only. No conflict resolution, trust management, key access, Git export, Git remote or push tool is exposed over MCP. Approval settings apply in Codex; they are not server-side per-agent authorization. The local API token still grants full application access and must remain restricted to trusted clients.

A server instruction or project rule is guidance, not proof that every model will comply. Shared validation rejects recognizable secrets on every write. Human review remains necessary, particularly for indirect or obfuscated secrets and instructions embedded in notes. Do not request automated transcript ingestion.

## Portable environment-variable fallback

For Windows or a client without header-helper support, merge [config.example.toml](config.example.toml) into the chosen Codex config. Provide `LOCALMIND_API_TOKEN` in the environment of the process launching Codex, using your local credential mechanism. Never replace `bearer_token_env_var` with the token value, put a token in shell history, or commit a literal Authorization header. A desktop app launched from the GUI may not inherit a terminal's environment; use the supported local header-helper route on macOS/Linux or arrange secure environment injection outside the notebook.

For availability across multiple projects, the printed managed block can be reviewed and added to your user-level Codex config. Project instructions must still be installed where needed. The setup command deliberately defaults to project scope and does not edit your home directory.

## Troubleshooting and removal

- **Server unavailable:** start `npm start`, confirm the port, then run `--check`. Cloud Codex workers cannot reach a server bound to your laptop's loopback address.
- **Authentication unavailable:** verify the token file exists and has owner-only permissions. Never paste its value into a conversation. Setup can be run before first start, but the helper and check require the generated token file.
- **Missing tools:** confirm project trust, open a new local session, and inspect `/mcp`. In a sandbox that isolates loopback, allow the local endpoint through the client's normal approval/policy mechanism; the installer never disables sandboxing.
- **Existing unmanaged config:** use the printed block and merge it manually; the installer will not overwrite that server definition.
- **Remove integration:** remove only the LocalMind marked block from `.codex/config.toml` and the marked integration section from `AGENTS.md`. Keep other project rules and servers. Notebook data is unaffected.

Implementation follows the official [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Header helpers are for local HTTP MCP connections; this integration does not set up OAuth or a public endpoint.
