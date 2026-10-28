const $ = id => document.getElementById(id);
let token = '', notes = [], selected = null, history = [], loadedHeads = [];
let integrationVersion = 0, projectPreview = null;
const status = message => { $('status').textContent = message; };
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
}
function fill(content) { $('title').value = content.title; $('body').value = content.body; $('author').value = content.thoughtAuthor; $('parent').value = content.parentId ?? ''; }
function descendants(id) { const found = new Set([id]); let changed = true; while (changed) { changed = false; for (const note of notes) if (found.has(note.parentId) && !found.has(note.id)) { found.add(note.id); changed = true; } } return found; }
function parents() {
  $('parent').replaceChildren(new Option('Workspace root', ''));
  const excluded = selected ? descendants(selected) : new Set();
  for (const n of notes) if (!excluded.has(n.id)) $('parent').append(new Option(n.title, n.id));
}
function renderTree() {
  $('tree').replaceChildren();
  const render = parentId => {
    const ul = document.createElement('ul');
    for (const n of notes.filter(n => n.parentId === parentId)) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.textContent = (n.conflicted ? '⚠ ' : '') + n.title;
      button.setAttribute('aria-current', String(n.id === selected));
      button.onclick = () => select(n.id).catch(e => status(e.message));
      li.append(button, render(n.id)); ul.append(li);
    }
    return ul;
  };
  $('tree').append(render(null));
}
async function reload() { notes = await api('notes'); renderTree(); }
function showHistory() {
  $('history').replaceChildren(); $('versions').replaceChildren();
  for (const event of history.slice().reverse()) {
    const detail = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = `${event.timestamp} · signer ${event.signerId.slice(0, 12)}… · ${event.id}`;
    pre.textContent = JSON.stringify({ signedBy: event.signerId, parents: event.parents, declaredThoughtAuthor: event.content.thoughtAuthor, ...event.content }, null, 2);
    detail.append(summary, pre); $('history').append(detail);
    if (loadedHeads.length > 1 && loadedHeads.includes(event.id)) {
      const version = detail.cloneNode(true), use = document.createElement('button'); version.open = true; use.type = 'button'; use.textContent = 'Use this version as a starting point';
      use.onclick = () => { fill(event.content); $('reviewed').checked = false; }; version.append(use); $('versions').append(version);
    }
  }
}
async function select(id) {
  const note = notes.find(n => n.id === id); if (!note) return;
  showNotes();
  selected = id; loadedHeads = [...note.heads]; parents(); fill(note);
  $('editor-heading').textContent = 'Edit note'; $('state').textContent = note.conflicted ? 'CONFLICT' : 'SAVED';
  $('conflict').hidden = !note.conflicted; $('reviewed').checked = false;
  history = await api(`notes/${id}/history`); showHistory(); renderTree();
}
$('login-form').onsubmit = async event => { event.preventDefault(); token = $('token').value; $('token').value = ''; try { await reload(); $('login').hidden = true; $('workspace').hidden = false; parents(); status('Workspace unlocked. Never store credentials in notes.'); } catch (error) { token = ''; status(error.message); } };
$('new').onclick = () => { showNotes(); const parent = selected; selected = null; loadedHeads = []; parents(); fill({ title: '', body: '', thoughtAuthor: '', parentId: parent }); $('editor-heading').textContent = 'New note'; $('state').textContent = 'DRAFT'; $('conflict').hidden = true; $('history').replaceChildren(); renderTree(); $('title').focus(); };
$('editor').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const conflicted = loadedHeads.length > 1;
    if (conflicted && !$('reviewed').checked) throw new Error('Review every version and confirm the resolution first.');
    const data = { title: $('title').value, body: $('body').value, thoughtAuthor: $('author').value, parentId: $('parent').value || null, expectedHeads: loadedHeads, humanReviewed: $('reviewed').checked };
    const result = await api(selected ? `notes/${selected}${conflicted ? '/resolve' : ''}` : 'notes', selected && !conflicted ? 'PUT' : 'POST', data);
    await reload(); await select(result.noteId); status('Saved as a new signed event.');
  } catch (error) { status(error.message); } finally { $('save').disabled = false; }
};
$('export').onclick = async () => { try { const result = await api('sync/export', 'POST', {}); status(`Exported ${result.count} encrypted events to ${result.directory}. Review files before committing.`); } catch (error) { status(error.message); } };
$('import').onclick = async () => { try { const result = await api('sync/import', 'POST', {}); await reload(); if (selected) await select(selected); status(`Imported ${result.imported} events. ${result.conflicts.length} notes need human conflict review.`); } catch (error) { status(error.message); } };
function showNotes() { $('notes-panel').hidden = false; $('codex-panel').hidden = true; $('codex').setAttribute('aria-pressed', 'false'); }
function clearPreview() {
  integrationVersion++; projectPreview = null;
  $('codex-review').hidden = true; $('codex-next').hidden = true;
  $('codex-approved').checked = false; $('codex-connect').disabled = true;
  $('codex-changes').replaceChildren();
}
function projectPaths() { return $('project-paths').value.split(/\r?\n/).map(path => path.trim()).filter(Boolean); }
function renderProjects(paths) {
  $('codex-projects').replaceChildren();
  if (!paths.length) { const item = document.createElement('li'); item.textContent = 'No projects added here yet.'; $('codex-projects').append(item); }
  for (const path of paths) {
    const item = document.createElement('li'), label = document.createElement('code'), review = document.createElement('button');
    label.textContent = path; review.type = 'button'; review.className = 'secondary'; review.textContent = 'Review this project'; review.setAttribute('aria-label', 'Review ' + path);
    review.onclick = () => { $('project-paths').value = path; clearPreview(); $('project-paths').focus(); status('Choose Review changes to check this project.'); };
    item.append(label, review); $('codex-projects').append(item);
  }
}
$('codex').onclick = async () => {
  $('notes-panel').hidden = true; $('codex-panel').hidden = false; $('codex').setAttribute('aria-pressed', 'true'); $('codex-heading').focus();
  const version = integrationVersion;
  try {
    const result = await api('integrations/codex');
    if (!token || version !== integrationVersion) return;
    $('codex-unsupported').hidden = result.supported; $('codex-form').hidden = !result.supported;
    renderProjects(result.projects);
  } catch (error) { if (token) status(error.message); }
};
$('back-notes').onclick = showNotes;
$('project-paths').oninput = clearPreview;
$('codex-approved').onchange = () => { $('codex-connect').disabled = !projectPreview || !$('codex-approved').checked; };
$('codex-form').onsubmit = async event => {
  event.preventDefault(); clearPreview(); const version = integrationVersion, projects = projectPaths(); $('codex-preview').disabled = true;
  try {
    const result = await api('integrations/codex/preview', 'POST', { projects });
    if (!token || version !== integrationVersion) return;
    projectPreview = { projects, previewToken: result.previewToken };
    for (const project of result.projects) {
      const card = document.createElement('div'), heading = document.createElement('h3'), path = document.createElement('p'), files = document.createElement('ul');
      card.className = 'project-card'; heading.textContent = project.name; path.textContent = project.path; path.className = 'muted';
      for (const file of project.files) { const item = document.createElement('li'); item.textContent = `${file.action}: ${file.path}`; files.append(item); }
      card.append(heading, path, files); $('codex-changes').append(card);
    }
    $('codex-review').hidden = false; status('Review ready. No project files have been changed.');
  } catch (error) { if (token && version === integrationVersion) status(error.message); }
  finally { $('codex-preview').disabled = false; }
};
$('codex-connect').onclick = async () => {
  if (!projectPreview || !$('codex-approved').checked) return;
  const preview = projectPreview, version = integrationVersion; $('codex-connect').disabled = true; $('codex-preview').disabled = true; $('project-paths').disabled = true; $('codex-approved').disabled = true;
  try {
    const result = await api('integrations/codex/connect', 'POST', { ...preview, approved: true });
    if (!token || version !== integrationVersion) return;
    clearPreview(); $('codex-next').hidden = false;
    status(`Configured ${result.projects.length} project(s). Open a new Codex chat in each project to load LocalMind.`);
    const saved = await api('integrations/codex'); if (token) renderProjects(saved.projects);
  } catch (error) { if (token && version === integrationVersion) { clearPreview(); status(error.message); } }
  finally { $('codex-preview').disabled = false; $('project-paths').disabled = false; $('codex-approved').disabled = false; }
};
$('lock').onclick = () => { token = ''; notes = []; selected = null; history = []; loadedHeads = []; clearPreview(); showNotes(); $('project-paths').value = ''; $('codex-projects').replaceChildren(); $('editor').reset(); $('history').replaceChildren(); $('versions').replaceChildren(); $('tree').replaceChildren(); $('parent').replaceChildren(); $('workspace').hidden = true; $('login').hidden = false; status('Workspace locked.'); };
