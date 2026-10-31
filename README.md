# LocalMind

A local knowledge notebook for people and coding agents. Keep useful notes and decisions close to your projects, with a web interface and MCP access.

- Organize notes in a tree.
- Keep encrypted content and a signed, append-only history.
- Give coding agents access through MCP, with a mandatory no-secrets policy.
- Exchange encrypted events manually and review conflicts in the UI.

Built with Node.js, TypeScript, Fastify and SQLite. No Docker or cloud account required.

**MVP. Never store passwords or secrets in notes.** Desktop packaging and the multi-notebook setup are still being finalized.

## Quick start

Download or clone this repository, then open a terminal in its folder.

**macOS / Linux**

```sh
./start.sh
```

On macOS, you can also double-click `LocalMind.command`. If executable permissions are missing, use `bash start.sh`.

**Windows**

```bat
Start.cmd
```

You can also double-click `Start.cmd`.

The launcher prepares Node.js 24+ if needed, installs dependencies, builds LocalMind and opens your browser. The first run needs internet access; later runs reuse the prepared files.

1. Open [localhost:4317](http://127.0.0.1:4317) if the browser does not open automatically.
2. Enter the local token from `data/api-token`, or the token-file path shown at startup. Keep its value private.
3. Keep the terminal window open. Press **Ctrl+C** to stop LocalMind.

Application logs are saved to `data/logs/localmind.log`. Custom data directories change these paths; the terminal shows the exact locations.

## Connect a coding agent

Use the [Codex integration guide](integrations/codex/README.md) for setup, authentication and agent rules. Keep LocalMind running while your local agent uses it.

## More information

- [Technical reference](docs/technical-reference.md): configuration, API, storage, encryption, logs and manual Git exchange.
- [Contributing](CONTRIBUTING.md) and [agent instructions](AGENTS.md): development workflow, tests and safety rules.
- [Security](SECURITY.md): limitations and vulnerability reporting.

For development, use Node.js 24+ and run `npm ci --ignore-scripts`, then `npm test`.
