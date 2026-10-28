import type { FastifyInstance } from 'fastify';
import { createHmac, randomBytes } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ConflictError, InputError, object } from './security.js';

type FileChange = { path: string; before: string | null; after: string; mode: number };
type InstallPlan = { project: string; files: FileChange[] };
type Setup = {
  prepareInstall: (project: string, options: { url: string; tokenFile: string }) => InstallPlan;
  applyInstallPlans: (plans: InstallPlan[]) => void;
  readOptional: (path: string) => string | null;
};
// Like web assets, the CLI's shared installer stays in the source distribution.
const loadSetup = () => import(new URL('../../scripts/setup-codex.mjs', import.meta.url).href) as Promise<Setup>;
const maxProjects = 32;
const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path)); };

export function registerCodexProjects(app: FastifyInstance, dataDir: string, port: number) {
  const sealKey = randomBytes(32), notebook = realpathSync(dataDir);
  const registryPath = join(notebook, 'codex-projects.json');
  const options = { url: `http://127.0.0.1:${port}/mcp`, tokenFile: join(notebook, 'api-token') };
  const supported = process.platform !== 'win32';
  async function registry() {
    const setup = await loadSetup(), before = setup.readOptional(registryPath);
    const parsed = before === null ? { version: 1, projects: [] } : JSON.parse(before);
    if (parsed.version !== 1 || !Array.isArray(parsed.projects) || parsed.projects.length > 256 || parsed.projects.some((path: unknown) => typeof path !== 'string' || path.length > 4096 || !isAbsolute(path))) throw new Error('Invalid local project registry');
    return { setup, before, projects: parsed.projects as string[] };
  }
  async function plan(body: unknown) {
    if (!supported) throw new InputError('The project setup UI currently supports macOS and Linux. Use the documented environment-variable configuration on Windows.');
    const { projects } = object(body);
    if (!Array.isArray(projects) || !projects.length || projects.length > maxProjects) throw new InputError(`Choose between 1 and ${maxProjects} existing project folders.`);
    const paths: string[] = [];
    for (const value of projects) {
      if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) || !isAbsolute(value)) throw new InputError('Use a full, absolute folder path for every project.');
      let path: string;
      try {
        const stat = lstatSync(value);
        if (stat.isSymbolicLink() || !stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error();
        path = realpathSync(value);
      } catch { throw new InputError('A project folder is missing, is a symbolic link, or is not owned by your account. Check the selected paths.'); }
      const home = realpathSync(homedir());
      if (path === dirname(path) || path === home || inside(join(home, '.codex'), path) || inside(notebook, path) || path.split(sep).some(part => ['.git', '.codex', 'node_modules'].includes(part))) throw new InputError('Choose a project folder, outside Codex settings, notebook data and dependency folders.');
      if (paths.includes(path)) throw new InputError('Choose each project folder only once.');
      paths.push(path);
    }
    const state = await registry();
    let plans: InstallPlan[];
    try { plans = paths.map(path => state.setup.prepareInstall(path, options)); }
    catch { throw new InputError('A project has unsafe files, conflicting LocalMind configuration or malformed managed blocks. No project files were changed. Review its .codex/config.toml, AGENTS.md and .gitignore.'); }
    const saved = [...new Set([...state.projects, ...paths])].sort();
    if (saved.length > 256) throw new InputError('The local project list is full.');
    const registryPlan: InstallPlan = { project: notebook, files: [{ path: registryPath, before: state.before, after: JSON.stringify({ version: 1, projects: saved }, null, 2) + '\n', mode: 0o600 }] };
    const all = [...plans, registryPlan];
    const previewToken = createHmac('sha256', sealKey).update(JSON.stringify(all)).digest('hex');
    const summary = plans.map(item => ({ path: item.project, name: basename(item.project), files: item.files.map(file => ({ path: relative(item.project, file.path), action: file.before === file.after ? 'unchanged' : file.before === null ? 'create' : 'update' })) }));
    return { setup: state.setup, all, previewToken, projects: summary };
  }
  app.get('/api/integrations/codex', async () => {
    const { projects } = await registry();
    return { supported, maxProjects, projects, sharedNotebook: true };
  });
  app.post('/api/integrations/codex/preview', async req => {
    const result = await plan(req.body);
    return { previewToken: result.previewToken, projects: result.projects };
  });
  app.post('/api/integrations/codex/connect', async req => {
    const body = object(req.body);
    if (body.approved !== true || typeof body.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.previewToken)) throw new InputError('Review the proposed files and explicitly approve project setup first.');
    const result = await plan(body);
    if (body.previewToken !== result.previewToken) throw new ConflictError('Project files or the project list changed. Review the changes again before connecting.');
    try { result.setup.applyInstallPlans(result.all); }
    catch { throw new InputError('Could not complete project setup. Review the selected folders and their file permissions before retrying.'); }
    return { projects: result.projects, restartRequired: true };
  });
}
