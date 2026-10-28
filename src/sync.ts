import { mkdirSync, lstatSync, existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Core } from './core.js';
import { canonical, InputError } from './security.js';
// Deliberately no clone, fetch, pull, commit, remote-add or push capability.
export class GitSync {
  constructor(private core: Core) {}
  plan(remote?: string) {
    if (remote) {
      let url: URL; try { url = new URL(remote); } catch { throw new InputError('Use an HTTPS GitHub or Bitbucket URL'); }
      if (url.protocol !== 'https:' || !['github.com', 'bitbucket.org'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname)) throw new InputError('Unsupported remote URL');
    }
    return { mode: 'manual-review', networkEnabled: false, remote: remote ?? null, steps: ['Export encrypted signed events', 'Review diff in a dedicated repository', 'Explicitly approve remote and network operations outside this MVP', 'Import verified events; resolve conflicts in the UI'], warnings: ['Never commit the data directory, identity, encryption key or API token.', 'Signer, timestamp, note IDs and graph metadata remain visible in exported events.'] };
  }
  directory() {
    const dir = join(this.core.dir, 'exchange');
    if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw new InputError('Unsafe exchange directory');
    mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir;
  }
  export() {
    const dir = this.directory();
    for (const e of this.core.events()) {
      const file = join(dir, e.id + '.json'), content = canonical(e) + '\n';
      if (existsSync(file)) {
        if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || readFileSync(file, 'utf8') !== content) throw new InputError('Existing exchange file differs or is unsafe');
        continue;
      }
      const temp = file + '.tmp'; writeFileSync(temp, content, { flag: 'wx', mode: 0o600 }); renameSync(temp, file);
    }
    return { count: this.core.events().length, directory: dir };
  }
  import() {
    const dir = this.directory(), names = readdirSync(dir).filter(n => n.endsWith('.json'));
    if (names.length > 5000) throw new InputError('Exchange has too many events');
    let bytes = 0;
    const events = names.map(name => {
      if (!/^[a-zA-Z0-9-]{1,100}\.json$/.test(name)) throw new InputError('Invalid event filename');
      const file = join(dir, name), stat = lstatSync(file); bytes += stat.size;
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 500000 || bytes > 20000000) throw new InputError('Unsafe or oversized exchange file');
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new InputError('Invalid exchange JSON'); }
    });
    return this.core.import(events);
  }
}
