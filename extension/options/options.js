// Reconnect a library: read <root>/<collection>/<folder>/clip.md files from a chosen folder and hand them to the
// background worker, which rebuilds its list and one-clip-per-page index. Read-only: nothing on disk changes.
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
    + (root !== 'artspo' ? ` Note: Artspo saves to Downloads/artspo, and this folder is named “${root}”. New clips will still go to Downloads/artspo.` : '');
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

async function known() {
  const s = await call('state');
  const n = s?.queue?.length || 0;
  $('known').textContent = n ? `${n} clip${n === 1 ? '' : 's'} in the list, across ${s.collections.length} collection${s.collections.length === 1 ? '' : 's'} (${s.collections.join(', ')}).` : 'Nothing yet. Clip a page, or reconnect an existing library above.';
}
known();
