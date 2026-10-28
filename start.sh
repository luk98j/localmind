#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usable_node() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1
}

if [ "${LOCALMIND_PORTABLE_NODE:-0}" = 1 ] || ! usable_node; then
  version="$(tr -d '\r\n' < "$ROOT/scripts/node-version")"
  [[ "$version" =~ ^24\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid bundled runtime version.' >&2; exit 1; }
  case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) echo 'Use Start.cmd on Windows.' >&2; exit 1;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo 'Unsupported CPU architecture.' >&2; exit 1;; esac
  folder="node-v${version}-${platform}-${arch}"
  runtime="$ROOT/.localmind/runtime/$folder"
  if [ ! -x "$runtime/bin/node" ] || [ ! -f "$runtime/lib/node_modules/npm/bin/npm-cli.js" ]; then
    command -v curl >/dev/null && command -v tar >/dev/null || { echo 'curl and tar are required to download Node.js.' >&2; exit 1; }
    mkdir -p "$ROOT/.localmind/runtime"
    stage="$(mktemp -d "$ROOT/.localmind/download.XXXXXX")"
    trap 'rm -rf -- "$stage"' EXIT
    archive="$folder.tar.gz"
    expected="$(awk -v file="$archive" '$2 == file {print $1}' "$ROOT/scripts/node-shasums.txt")"
    [ "${#expected}" = 64 ] || { echo 'No trusted checksum for this runtime.' >&2; exit 1; }
    echo 'Preparing a local Node.js runtime. No system installation is needed.'
    curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 --retry 2 "https://nodejs.org/dist/v${version}/${archive}" --output "$stage/$archive"
    if command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "$stage/$archive" | awk '{print $1}')"
    elif command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$stage/$archive" | awk '{print $1}')"
    else echo 'A SHA-256 checksum utility is required.' >&2; exit 1; fi
    [ "$actual" = "$expected" ] || { echo 'Node.js checksum mismatch. Download rejected.' >&2; exit 1; }
    tar -xzf "$stage/$archive" -C "$stage"
    "$stage/$folder/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'
    # Moving into the parent with -n avoids replacing another completed download.
    mv -n "$stage/$folder" "$ROOT/.localmind/runtime/"
    rm -rf -- "$stage"
    trap - EXIT
  fi
  export PATH="$runtime/bin:$PATH"
fi
usable_node || { echo 'A working Node.js 24+ runtime with npm is required.' >&2; exit 1; }
exec node "$ROOT/scripts/launch.mjs" "$@"
