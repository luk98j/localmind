# macOS installation

Open the LocalMind `.dmg`, drag **LocalMind.app** onto **Applications**, eject the disk image, then launch LocalMind from Applications. The package includes Node.js and the local backend; end users do not need npm, Docker or a terminal.

This development build is ad-hoc signed and has not been notarized by Apple. macOS may require approval through its normal security controls. Do not disable Gatekeeper or remove quarantine attributes as an installation step. Public notarized distribution requires an Apple Developer signing identity and notarization credentials managed outside this repository.

The installer contains the application, an Applications shortcut and installation instructions. It includes no notebook data, local identities, API tokens or user-specific Codex configuration. Opening the app starts its own loopback backend and authenticates the UI locally. Close another LocalMind instance using the same port before launching it.

Desktop data defaults to `~/Library/Application Support/app.localmind.desktop`. This is separate from terminal mode's default `data/` folder. Installing or replacing the application does not move existing notebooks or change Codex settings; connect Codex from the running app after reviewing the proposed configuration. Do not run two instances against the same data directory.

## Create a DMG from a built app

From the repository root on macOS:

```sh
npm run package:mac
```

The script packages the existing host-architecture bundle under `desktop/src-tauri/target/<target>/release/bundle/macos/LocalMind.app`. It verifies the source signature and rejects known private runtime files. It copies the bundle to temporary staging, applies ad-hoc development signatures with the JIT entitlement limited to the bundled Node.js runtime, verifies the signatures and executes a JavaScript startup probe. It then creates a compressed read-only disk image, verifies the image and writes a SHA-256 checksum beside it. It refuses to overwrite an existing output.

To select a bundle and output location explicitly:

```sh
npm run package:mac -- --app /path/to/LocalMind.app --output /path/to/LocalMind.dmg
```

Packaging requires a successfully built `.app` and macOS's built-in `hdiutil`, `ditto` and `codesign`. It does not build source, download dependencies, sign with a developer identity, notarize, upload or install anything into Applications automatically. The selected application must match the packaging machine’s architecture; a package built for Apple Silicon is not an Intel package.
