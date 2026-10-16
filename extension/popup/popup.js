const $ = (id) => document.getElementById(id);
const call = (type, extra = {}) => chrome.runtime.sendMessage({ target: 'background', type, ...extra });
const NEW = '__new__';
const isMac = navigator.platform.toLowerCase().includes('mac');
$('saveKey').textContent = isMac ? '⌘↵' : 'Ctrl↵';

let tab;
let existing = null;    // this page's existing clip, if any
let editing = null;     // id of the clip whose note is being edited (pauses list re-renders)
let savedJobId = null;

function noteEditor(j, li) {
  const box = document.createElement('div');
  box.className = 'editor';
  const ta = document.createElement('textarea');
  ta.value = j.note || '';
  ta.placeholder = 'What caught your eye?';
  const err = document.createElement('div');
  err.className = 'err';
  const btns = document.createElement('div');
  btns.className = 'row-btns';
  const cancel = document.createElement('button');
  cancel.className = 'ghost'; cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.className = 'ghost'; save.textContent = 'Save note';
  const close = () => { editing = null; refresh(); };
  cancel.onclick = close;
  const doSave = async () => {
    save.disabled = true;
    const res = await call('setNote', { id: j.id, note: ta.value });
    if (res?.error) { err.textContent = res.error; save.disabled = false; return; }
    close();
  };
  save.onclick = doSave;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); doSave(); } });
  btns.append(cancel, save);
  box.append(ta, err, btns);
  li.append(box);
  ta.focus();
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function renderJobs(queue, processing) {
  if (editing) return;
  const ul = $('jobs');
  ul.textContent = '';
  const pending = queue.filter((j) => j.status === 'queued' || j.status === 'running').length;
  $('queueState').textContent = processing ? 'inspecting…' : pending ? `${pending} waiting for idle` : 'all inspected';
  $('processNow').disabled = !pending || processing;
  $('processNow').hidden = !(pending && !processing);
  const finished = queue.filter((j) => ['done', 'partial', 'failed'].includes(j.status)).length;
  $('reinspectAll').hidden = !(finished && !pending && !processing);
  if (!queue.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing clipped yet. ';
    const r = document.createElement('button');
    r.className = 'link'; r.textContent = 'Already have a library? Reconnect it';
    r.onclick = () => call('openOptions');
    li.append(r);
    ul.append(li);
    return;
  }
  for (const j of queue.slice(0, 12)) {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'job-main';
    const t = document.createElement('div');
    t.className = 'job-title';
    t.textContent = j.title || j.url;
    const sub = document.createElement('div');
    sub.className = 'job-sub';
    let detail = `${j.collection} · ${timeAgo(j.clippedAt)}`;
    if (j.status === 'running' && j.progress) detail = j.progress;
    if (j.status === 'done' && j.summary?.libs?.length) detail += ` · ${j.summary.libs.slice(0, 2).map((l) => l.replace(/ \(.*/, '')).join(', ')}`;
    if ((j.status === 'failed' || j.status === 'queued') && j.error) detail = j.error;
    sub.textContent = detail;
    sub.title = j.localPath || j.dir;
    main.append(t, sub);

    const pill = document.createElement('span');
    pill.className = `pill ${j.status}`;
    pill.textContent = { queued: 'queued', running: 'inspecting', done: 'done', partial: 'partial', failed: 'failed' }[j.status] || j.status;
    if (j.summary?.throttled) pill.title = 'Chrome throttled the inspection — motion timings may be incomplete';

    li.append(main, pill);
    const nb = document.createElement('button');
    nb.className = `job-act note${j.note ? '' : ' empty'}`;
    nb.textContent = j.note ? 'note' : '+ note';
    nb.title = j.note ? j.note : 'Add what caught your eye';
    nb.onclick = () => { editing = j.id; noteEditor(j, li); };
    li.append(nb);
    if (j.status === 'done' || j.status === 'failed' || j.status === 'partial') {
      const b = document.createElement('button');
      b.className = 'job-act re';
      b.textContent = '↻';
      b.title = j.status === 'done' ? 'Re-inspect with the latest version (keeps the note and seen.jpg)' : 'Try the inspection again';
      b.setAttribute('aria-label', 'Re-inspect ' + (j.title || j.url));
      b.onclick = () => call('reinspect', { id: j.id }).then(refresh);
      li.append(b);
    }
    if (j.status !== 'running') {
      const x = document.createElement('button');
      x.className = 'job-act';
      x.textContent = '×';
      x.title = 'Remove from this list (files stay on disk)';
      x.onclick = () => call('remove', { id: j.id }).then(refresh);
      li.append(x);
    }
    ul.append(li);
  }
}

function renderCollections(collections, selected) {
  const sel = $('collection');
  sel.textContent = '';
  for (const c of collections) sel.append(new Option(c, c, false, c === selected));
  sel.append(new Option('+ New collection…', NEW));
}

async function refresh() {
  const s = await call('state');
  if (!s || s.error) return;
  renderJobs(s.queue, s.processing);
  if (!$('collection').options.length) renderCollections(s.collections, s.lastCollection);
  $('idle').value = String(s.settings.idleSeconds);
}

async function init() {
  const forced = new URLSearchParams(location.search).get('tabId'); // for opening the popup as a page while debugging
  [tab] = forced ? [await chrome.tabs.get(+forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = tab && /^https?:/.test(tab.url || '');
  $('pageTitle').textContent = tab?.title || '—';
  $('pageHost').textContent = ok ? new URL(tab.url).hostname.replace(/^www\./, '') : 'This page can’t be clipped';
  if (tab?.favIconUrl) $('favicon').src = tab.favIconUrl; else $('favicon').hidden = true;
  if (!ok) $('save').disabled = true;
  await refresh();
  if (ok) {
    // already clipped? then saving updates that clip instead of making another folder
    const res = await call('lookup', { url: tab.url });
    const ex = res?.existing;
    if (ex) {
      existing = ex;
      $('already').hidden = false;
      $('already').innerHTML = '';
      const b = document.createElement('b'); b.textContent = ex.collection;
      $('already').append('Already clipped to ', b, ` · ${timeAgo(ex.clippedAt)}. Saving updates that clip: a fresh screenshot and inspection, same folder.`);
      $('note').value = ex.note || '';
      $('tags').value = (ex.tags || []).join(', ');
      if (![...$('collection').options].some((o) => o.value === ex.collection)) $('collection').prepend(new Option(ex.collection, ex.collection));
      $('collection').value = ex.collection;
      $('collection').disabled = true;
      $('save').firstChild.textContent = 'Update clip ';
      if (ex.status === 'running') { $('save').disabled = true; $('already').append(' It is being inspected right now.'); }
    }
  }
  $('note').focus();
}

$('collection').addEventListener('change', () => {
  const isNew = $('collection').value === NEW;
  $('newCollection').hidden = !isNew;
  if (isNew) $('newCollection').focus();
});

async function save() {
  if ($('save').disabled) return;
  const collection = $('collection').value === NEW ? $('newCollection').value.trim() : $('collection').value;
  if (!collection) { $('newCollection').focus(); return; }
  const tags = $('tags').value.split(/[,#]/).map((t) => t.trim()).filter(Boolean);
  $('save').disabled = true;
  $('error').hidden = true;
  const res = await call('clip', {
    data: { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, collection, tags, note: $('note').value.trim() },
  });
  if (!res || res.error) {
    $('error').textContent = res?.error || 'Something went wrong';
    $('error').hidden = false;
    $('save').disabled = false;
    return;
  }
  $('clipForm').hidden = true;
  $('saved').hidden = false;
  if (res.job.updated) $('saved').querySelector('.saved-title').firstChild.textContent = 'Updated clip in ';
  $('savedCollection').textContent = res.job.collection;
  $('savedPath').textContent = res.job.localPath || `Downloads/${res.job.dir}`;
  savedJobId = res.job.id;
  if (!res.job.note) { $('lateNote').hidden = false; $('lateNoteText').focus(); }
  refresh();
}

$('save').addEventListener('click', save);
async function saveLateNote() {
  const note = $('lateNoteText').value.trim();
  if (!note || !savedJobId) return;
  $('saveLateNote').disabled = true;
  const res = await call('setNote', { id: savedJobId, note });
  if (res?.error) { $('saveLateNote').disabled = false; return; }
  $('lateNote').hidden = true;
  $('noted').hidden = false;
}
$('saveLateNote').addEventListener('click', saveLateNote);
$('saveLateNote').querySelector('kbd').textContent = isMac ? '⌘↵' : 'Ctrl↵';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  if (!$('lateNote').hidden) saveLateNote(); else if (!$('clipForm').hidden) save();
});
$('processNow').addEventListener('click', () => call('processNow').then(refresh));
$('reinspectAll').addEventListener('click', () => call('reinspectAll').then(refresh));
$('idle').addEventListener('change', () => call('settings', { settings: { idleSeconds: +$('idle').value } }));
$('openFolder').addEventListener('click', () => call('showFolder'));
$('openCatalogue').addEventListener('click', async () => {
  const res = await call('openCatalogue');
  const m = $('footMsg');
  m.hidden = !res?.error;
  if (!res?.error) return;
  m.textContent = res.error + (res.path ? ' ' : '');
  if (res.path) { const c = document.createElement('code'); c.textContent = res.path; m.append(c); }
});
chrome.runtime.onMessage.addListener((m) => { if (m?.target === 'popup' && m.type === 'changed') refresh(); });

init();
