import { openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

// This is a credential helper, not an agent tool. Never log its output.
export function readToken(tokenFile) {
  if (!tokenFile) throw new Error('A local token file is required');
  const fd = openSync(tokenFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 256 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new Error('Token file must be a small regular file with owner-only permissions');
    }
    const token = readFileSync(fd, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid LocalMind token file');
    return token;
  } finally { closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify({ Authorization: 'Bearer ' + readToken(process.argv[2]) }));
  } catch {
    process.stderr.write('LocalMind authentication unavailable. Check the token file and its permissions.\n');
    process.exitCode = 1;
  }
}
