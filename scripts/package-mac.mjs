import { existsSync, lstatSync, readdirSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

if (process.platform !== 'darwin') throw new Error('DMG packaging requires macOS');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const here = join(root, 'desktop');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : process.arch === 'x64' ? 'x86_64-apple-darwin' : null;
if (!triple) throw new Error('Unsupported macOS architecture');
const { values } = parseArgs({ options: { app: { type: 'string' }, output: { type: 'string' } } });
const app = resolve(values.app ?? join(here, 'src-tauri/target', triple, 'release/bundle/macos/LocalMind.app'));
const output = resolve(values.output ?? join(here, 'src-tauri/target', triple, `release/bundle/dmg/LocalMind-${version}-macOS-${process.arch}.dmg`));
if (!app.endsWith('.app') || !lstatSync(app).isDirectory() || lstatSync(app).isSymbolicLink() || !existsSync(join(app, 'Contents/Info.plist'))) throw new Error('Choose a built LocalMind application bundle');
if (existsSync(output) || existsSync(output + '.sha256')) throw new Error('Output already exists; choose a new output path');
function inspect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'api-token' || entry.name === 'identity.json' || /\.sqlite(?:-wal|-shm)?$/.test(entry.name)) throw new Error('Application contains private runtime data; packaging refused');
    if (entry.isDirectory()) inspect(join(path, entry.name));
  }
}
inspect(app);
if (existsSync(join(app, 'Contents/Resources/backend/data'))) throw new Error('Application contains a notebook data directory');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error('macOS packaging or verification failed');
}
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const stage = mkdtempSync(join(tmpdir(), 'localmind-dmg-'));
try {
  const stagedApp = join(stage, 'LocalMind.app');
  run('/usr/bin/ditto', [app, stagedApp]);
  // Tauri's ad-hoc signing can remove Node's JIT entitlement. Grant it only
  // to the bundled runtime, then seal the enclosing development application.
  const runtime = join(stagedApp, 'Contents/MacOS/node');
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', join(root, 'scripts/mac-node.entitlements.plist'), runtime]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', stagedApp]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
  run(runtime, ['-e', `if (process.arch !== ${JSON.stringify(process.arch)}) process.exit(1); console.log('Bundled JavaScript runtime verified');`]);
  symlinkSync('/Applications', join(stage, 'Applications'));
  writeFileSync(join(stage, 'Install LocalMind.txt'), `Install LocalMind\n\n1. Drag LocalMind.app onto Applications.\n2. Eject the LocalMind disk image.\n3. Open LocalMind from Applications. No Node.js installation or terminal is needed.\n\nLocalMind starts its own local backend. If another instance is using its port, close that instance before starting.\n\nThis is a development build with ad-hoc signing, without Apple notarization. macOS may request approval through its normal security controls. Do not disable system security.\n\nNever store passwords or secrets in notes. Notebook data remains in your account's application-data directory, outside this installer.\n`, { flag: 'wx' });
  mkdirSync(dirname(output), { recursive: true });
  run('/usr/bin/hdiutil', ['create', '-volname', 'LocalMind', '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', output]);
  run('/usr/bin/hdiutil', ['verify', output]);
  const checksum = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(output + '.sha256', checksum + '  ' + output.split('/').at(-1) + '\n', { flag: 'wx' });
  console.log(`Installer: ${output}\nChecksum: ${output}.sha256`);
} finally { rmSync(stage, { recursive: true, force: true }); }
