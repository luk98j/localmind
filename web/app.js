const $ = id => document.getElementById(id);
let token = '', notes = [], selected = null, history = [], loadedHeads = [];
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
  selected = id; loadedHeads = [...note.heads]; parents(); fill(note);
  $('editor-heading').textContent = 'Edit note'; $('state').textContent = note.conflicted ? 'CONFLICT' : 'SAVED';
  $('conflict').hidden = !note.conflicted; $('reviewed').checked = false;
  history = await api(`notes/${id}/history`); showHistory(); renderTree();
}
$('login-form').onsubmit = async event => { event.preventDefault(); token = $('token').value; $('token').value = ''; try { await reload(); $('login').hidden = true; $('workspace').hidden = false; parents(); status('Workspace unlocked. Never store credentials in notes.'); } catch (error) { token = ''; status(error.message); } };
$('new').onclick = () => { const parent = selected; selected = null; loadedHeads = []; parents(); fill({ title: '', body: '', thoughtAuthor: '', parentId: parent }); $('editor-heading').textContent = 'New note'; $('state').textContent = 'DRAFT'; $('conflict').hidden = true; $('history').replaceChildren(); renderTree(); $('title').focus(); };
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
$('lock').onclick = () => { token = ''; notes = []; selected = null; history = []; loadedHeads = []; $('editor').reset(); $('history').replaceChildren(); $('versions').replaceChildren(); $('tree').replaceChildren(); $('parent').replaceChildren(); $('workspace').hidden = true; $('login').hidden = false; status('Workspace locked.'); };
