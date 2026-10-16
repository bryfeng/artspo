// Setup: library folder, collections, agent skill, inspection timing, and reconnecting an existing library.
// Reconnect reads <library>/<collection>/<folder>/clip.md from a chosen folder and hands them to the background
// worker, which rebuilds its list and one-clip-per-page index. Read-only: nothing on disk changes.
const $ = (id) => document.getElementById(id);
const call = (type, extra = {}) => chrome.runtime.sendMessage({ target: 'background', type, ...extra });
let pending = [];

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    out[kv[1]] = v;
  }
  return out;
}
function noteOf(text) {
  const m = /\n## Note\n([\s\S]*?)(?=\n## |\n> |$)/.exec(text);
  const n = (m ? m[1] : '').trim();
  return n.startsWith('_(no note)') ? '' : n;
}

$('folder').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const status = $('status');
  status.hidden = false; status.className = 'status'; status.textContent = `Reading ${files.length} files…`;
  const paths = new Set(files.map((f) => f.webkitRelativePath));
  const clipFiles = files.filter((f) => /^[^/]+\/[^/]+\/[^/]+\/clip\.md$/.test(f.webkitRelativePath));
  const root = files[0]?.webkitRelativePath.split('/')[0] || '';
  const entries = [], skipped = [];
  for (const f of clipFiles) {
    const [, collection, folder] = f.webkitRelativePath.split('/');
    if (['patterns', 'reports', 'works', '_generated', 'skills'].includes(collection)) continue;
    const text = await f.text();
    const fm = frontmatter(text);
    if (!fm.url) { skipped.push([folder, 'no url in frontmatter']); continue; }
    if (fm.status === 'superseded') { skipped.push([folder, 'superseded']); continue; }
    entries.push({
      url: fm.url, title: fm.title || folder, collection: fm.collection || collection, folder,
      tags: Array.isArray(fm.tags) ? fm.tags : [], clippedAt: fm.clipped || '', status: fm.status || 'complete',
      note: noteOf(text), md: text, seen: paths.has(`${root}/${collection}/${folder}/seen.jpg`),
    });
  }
  const ul = $('found'); ul.textContent = ''; ul.hidden = !entries.length && !skipped.length;
  for (const x of entries) { const li = document.createElement('li'); li.append(Object.assign(document.createElement('span'), { textContent: x.title }), Object.assign(document.createElement('span'), { textContent: `${x.collection}/${x.folder}` })); ul.append(li); }
  for (const [f, why] of skipped) { const li = document.createElement('li'); li.className = 'skip'; li.append(Object.assign(document.createElement('span'), { textContent: f }), Object.assign(document.createElement('span'), { textContent: `skipped: ${why}` })); ul.append(li); }
  if (!entries.length) {
    status.className = 'status bad';
    status.textContent = 'No clips found. Choose the artspo folder itself (the one that contains inbox/ and your other collections).';
    $('confirmRow').hidden = true;
    return;
  }
  pending = entries;
  status.textContent = `Found ${entries.length} clip${entries.length === 1 ? '' : 's'}` + (skipped.length ? `, skipped ${skipped.length}.` : '.')
    + (state && root !== (state.settings.library || 'artspo').split('/').pop() ? ` Note: this folder is named “${root}”, but new clips go to Downloads/${state.settings.library || 'artspo'}. If this is your library, set that above to match first.` : '');
  $('count').textContent = `${entries.length} clip${entries.length === 1 ? '' : 's'}`;
  $('confirmRow').hidden = false;
});

$('confirm').addEventListener('click', async () => {
  $('confirm').disabled = true;
  const res = await call('importLibrary', { entries: pending });
  const status = $('status');
  if (res?.error) { status.className = 'status bad'; status.textContent = res.error; $('confirm').disabled = false; return; }
  status.className = 'status ok';
  status.textContent = `Reconnected: ${res.added} added, ${res.merged} already known.` + (res.added ? ' They show in the popup and can be re-inspected with ↻.' : '');
  $('confirmRow').hidden = true; $('confirm').disabled = false; pending = [];
  known();
});
$('cancel').addEventListener('click', () => { pending = []; $('confirmRow').hidden = true; $('found').hidden = true; $('status').hidden = true; $('folder').value = ''; });

// ---------------- setup ----------------
let state;
const show = (el, text, cls = 'status') => { el.hidden = false; el.className = cls; el.textContent = text; };

function linkCommands(library) {
  $('linkCmd').textContent = `mkdir -p ~/Dropbox/artspo && ln -s ~/Dropbox/artspo ~/Downloads/${library.replace(/ /g, '\\ ')}`;
  $('winCmd').textContent = `mklink /D "%USERPROFILE%\\Downloads\\${library.replace(/\//g, '\\')}" "D:\\Dropbox\\artspo"`;
}

function renderCollections() {
  const ul = $('colls'); ul.textContent = '';
  const counts = {};
  for (const j of state.queue) counts[j.collection] = (counts[j.collection] || 0) + 1;
  for (const c of state.collections) {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'cname'; name.textContent = c;
    const n = document.createElement('span'); n.className = 'count'; n.textContent = counts[c] ? `${counts[c]} clip${counts[c] === 1 ? '' : 's'}` : 'empty';
    li.append(name, n);
    if (c === state.lastCollection) {
      const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'default'; li.append(b);
    } else {
      const d = document.createElement('button'); d.type = 'button'; d.className = 'ghost small'; d.textContent = 'Make default';
      d.onclick = () => collections('default', c); li.append(d);
    }
    if (!counts[c] && state.collections.length > 1) {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'ghost small'; r.textContent = 'Remove';
      r.title = 'Removes it from the popup list. Files on disk are not touched.';
      r.onclick = () => collections('remove', c); li.append(r);
    }
    ul.append(li);
  }
}
async function collections(op, name) {
  const res = await call('collections', { op, name });
  if (res?.error) { show($('collStatus'), res.error, 'status bad'); return; }
  $('collStatus').hidden = true;
  Object.assign(state, res);
  renderCollections();
}
$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('newColl').value.trim();
  if (!v) return;
  await collections('add', v);
  $('newColl').value = '';
});

$('libraryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await call('setLibrary', { library: $('library').value });
  if (res?.error) { show($('libraryStatus'), res.error, 'status bad'); return; }
  $('library').value = res.library;
  linkCommands(res.library);
  const moved = res.changed && state.queue.length;
  show($('libraryStatus'), `Saved. New clips go to Downloads/${res.library}.` + (moved ? ' Clips you already have stay where they are. To bring them along, move their folders there yourself, then reconnect below.' : ''), 'status ok');
  state.settings.library = res.library;
  known();
});

$('idle').addEventListener('change', async () => {
  await call('settings', { settings: { idleSeconds: +$('idle').value } });
  $('idleSaved').hidden = false; setTimeout(() => ($('idleSaved').hidden = true), 1500);
});

document.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400); } catch {}
}));

async function known() {
  state = await call('state');
  const lib = state.settings.library || 'artspo';
  if (document.activeElement !== $('library')) $('library').value = lib;
  linkCommands(lib);
  $('idle').value = String(state.settings.idleSeconds);
  renderCollections();
  const n = state.queue.length;
  $('known').textContent = n ? `Artspo knows ${n} clip${n === 1 ? '' : 's'} in Downloads/${lib}.` : `No clips yet. They'll go to Downloads/${lib}.`;
}
if (new URLSearchParams(location.search).has('welcome')) {
  $('welcome').hidden = false;
  $('lede').textContent = 'Welcome. Artspo saves websites you like as a design library your AI agent can work from. Three things, then you\u2019re clipping:';
}
chrome.runtime.onMessage.addListener((m) => { if (m?.target === 'popup' && m.type === 'changed') known(); });
known();
