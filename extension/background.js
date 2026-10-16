import { inspect } from './lib/inspector.js';
import { writeFiles } from './lib/writer.js';
import { buildStub, buildClipMd, replaceNote, cleanNote, buildCollectionMd } from './lib/clipmd.js';
import { normUrl, cleanUrl } from './lib/url.js';

const DEFAULT_LIBRARY = 'artspo';
const MAX_ATTEMPTS = 3;
const KEEP_DONE = 100;
const DEFAULTS = { collections: ['inbox'], lastCollection: 'inbox', queue: [], settings: { idleSeconds: 120, library: DEFAULT_LIBRARY }, guideVersion: null, index: {}, collectionMeta: {} };

// ---------------- storage ----------------
const get = async (k) => (await chrome.storage.local.get(k))[k] ?? structuredClone(DEFAULTS[k]);
const set = (obj) => chrome.storage.local.set(obj);
async function updateJob(id, patch) {
  const queue = await get('queue');
  const j = queue.find((x) => x.id === id);
  if (j) Object.assign(j, patch);
  await set({ queue });
  broadcast();
  return j;
}
function broadcast() {
  chrome.runtime.sendMessage({ target: 'popup', type: 'changed' }).catch(() => {});
  refreshBadge();
}
async function refreshBadge() {
  const queue = await get('queue');
  const pending = queue.filter((j) => j.status === 'queued' || j.status === 'running').length;
  chrome.action.setBadgeText({ text: pending ? String(pending) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1a1a1a' });
}

// ---------------- library location ----------------
// Chrome only lets extensions save inside the Downloads folder, so the library is a path relative to it.
// (To keep it elsewhere, make that path a symlink to the real folder; downloads follow it.)
const libraryRoot = async () => (await get('settings')).library || DEFAULT_LIBRARY;
export function cleanLibrary(input) {
  const parts = String(input || '').replace(/^~?\/?(downloads\/)?/i, '').split(/[\\/]+/)
    .map((p) => p.trim().replace(/[^\w .-]/g, '').replace(/^\.+/, '').trim()).filter((p) => p && p !== '.' && p !== '..');
  if (!parts.length) throw new Error('Give the library folder a name, like artspo or Design/artspo.');
  return parts.join('/');
}

// ---------------- setup ----------------
async function init() {
  const settings = await get('settings');
  chrome.idle.setDetectionInterval(Math.max(15, settings.idleSeconds));
  chrome.alarms.create('artspo-tick', { periodInMinutes: 5 });
  // a job left "running" means the worker died mid-pass; put it back in line
  const queue = await get('queue');
  let dirty = false;
  for (const j of queue) if (j.status === 'running') { j.status = 'queued'; dirty = true; }
  if (dirty) await set({ queue });
  await dedupe();
  refreshBadge();
}

// ---------------- one clip per page ----------------
// index survives list pruning: normalized URL → where that page's clip lives
const indexEntry = (j) => ({ id: j.id, dir: j.dir, folder: j.folder, collection: j.collection, title: j.title,
  note: j.note || '', tags: j.tags || [], clippedAt: j.clippedAt, localPath: j.localPath });
async function remember(j) {
  const index = await get('index');
  index[normUrl(j.url)] = indexEntry(j);
  await set({ index });
}
// Older versions made a new folder per clip. Keep the newest clip of each page, carry over notes and tags.
async function dedupe() {
  const queue = await get('queue');
  const index = await get('index');
  const groups = new Map();
  for (const j of queue) {
    const k = normUrl(j.url);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }
  const drop = new Set();
  const superseded = [];
  for (const [k, g] of groups) {
    g.sort((a, b) => String(b.clippedAt).localeCompare(String(a.clippedAt)));
    const keep = g.find((j) => j.status === 'running') || g[0];
    for (const j of g) {
      if (j === keep) continue;
      if (!keep.note && j.note) keep.note = j.note;
      keep.tags = [...new Set([...(keep.tags || []), ...(j.tags || [])])];
      drop.add(j.id);
      superseded.push(j.dir);
    }
    index[k] = indexEntry(keep);
  }
  if (drop.size) {
    const prev = await get('superseded') || [];
    await set({ queue: queue.filter((j) => !drop.has(j.id)), index, superseded: [...prev, ...superseded] });
  } else {
    await set({ index });
  }
  return superseded;
}
chrome.runtime.onInstalled.addListener((details) => {
  init();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
});
chrome.runtime.onStartup.addListener(init);

chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'idle' || state === 'locked') processQueue('idle');
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'artspo-tick') return;
  const { idleSeconds } = await get('settings');
  const state = await chrome.idle.queryState(Math.max(15, idleSeconds));
  if (state !== 'active') processQueue('idle');
});

// ---------------- naming ----------------
const slug = (s, max = 40) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, max) || 'untitled';
export const collectionSlug = (s) => slug(s, 48);
function clipFolder(url, date) {
  const host = new URL(url).hostname.replace(/^www\./, '').replace(/\./g, '-');
  const id = Math.random().toString(36).slice(2, 6);
  return `${date.slice(0, 10)}_${slug(host)}_${id}`;
}
const localIso = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 19) + (off >= 0 ? '+' : '-') + pad(off / 60) + ':' + pad(off % 60);
};

async function agentsGuide() {
  const skill = await (await fetch(chrome.runtime.getURL('skills/artspo/SKILL.md'))).text();
  return skill.replace(/^---[\s\S]*?---\s*/, '')
    + '\n---\n_This file is written by the Artspo extension (v' + chrome.runtime.getManifest().version
    + '). The same instructions ship as an agent skill in the Artspo repo: extension/skills/artspo/SKILL.md._\n';
}

// ---------------- collections: brief + links ----------------
async function writeCollection(name) {
  const meta = (await get('collectionMeta'))[name] || {};
  await writeFiles([{ path: `${await libraryRoot()}/${name}/collection.md`, text: buildCollectionMd(name, meta) }]);
}
async function saveCollection({ name, title, brief }) {
  const coll = collectionSlug(name);
  const all = await get('collectionMeta');
  all[coll] = { ...(all[coll] || {}), title: String(title || '').trim() || coll, brief: String(brief || ''), updated: localIso().slice(0, 10) };
  const collections = await get('collections');
  if (!collections.includes(coll)) collections.push(coll);
  await set({ collectionMeta: all, collections });
  await writeCollection(coll);
  broadcast();
  return { name: coll, meta: all[coll] };
}
// Paste a list of links: each becomes a queued clip (no seen.jpg, since you never looked at it), inspected when idle.
// One URL per line; anything after it on the line is the note ("https://x.com — the nav animation").
async function addLinks({ collection, text }) {
  const coll = collectionSlug(collection || 'inbox');
  const root = await libraryRoot();
  const queue = await get('queue');
  const index = await get('index');
  const all = await get('collectionMeta');
  const meta = all[coll] || { title: coll, brief: '', links: [] };
  meta.links = meta.links || [];
  const added = [], skipped = [], files = [], seenKeys = new Set();
  for (const raw of String(text || '').split(/\n+/)) {
    const m = raw.trim().match(/^(?:[-*•]\s*)?(\S+)\s*(?:[—–:-]+\s*)?(.*)$/);
    if (!m || !m[1]) continue;
    let url = m[1].replace(/[<>]/g, '').replace(/[:,;.)]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = /^[\w-]+(\.[\w-]+)+/.test(url) ? 'https://' + url : '';
    if (!url) { if (raw.trim()) skipped.push({ url: raw.trim().slice(0, 80), why: 'not a link' }); continue; }
    try { new URL(url); } catch { skipped.push({ url, why: 'not a link' }); continue; }
    url = cleanUrl(url);
    const key = normUrl(url);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const known = queue.find((j) => normUrl(j.url) === key) || index[key];
    if (known) { skipped.push({ url, why: `already clipped, in ${known.collection}` }); continue; }
    const clippedAt = localIso();
    const folder = clipFolder(url, clippedAt);
    const note = cleanNote(m[2]);
    const job = {
      id: crypto.randomUUID(), url, title: new URL(url).hostname.replace(/^www\./, ''), collection: coll, tags: [], note,
      clippedAt, folder, dir: `${root}/${coll}/${folder}`, status: 'queued', attempts: 0, seen: false, fromList: true,
    };
    job.md = buildStub(job);
    files.push({ path: `${job.dir}/clip.md`, text: job.md });
    queue.unshift(job);
    index[key] = indexEntry(job);
    meta.links.push({ url, why: note, added: clippedAt.slice(0, 10) });
    added.push(url);
  }
  if (added.length) {
    meta.updated = localIso().slice(0, 10);
    all[coll] = meta;
    const collections = await get('collections');
    if (!collections.includes(coll)) collections.push(coll);
    files.push({ path: `${root}/${coll}/collection.md`, text: buildCollectionMd(coll, meta) });
    await writeFiles(files);
    await set({ queue, index, collectionMeta: all, collections });
    broadcast();
  }
  return { added, skipped, collection: coll };
}

// ---------------- clip (instant) ----------------
async function clip({ tabId, windowId, url, title, collection, tags, note }) {
  if (!/^https?:/.test(url)) throw new Error('Only http(s) pages can be clipped');
  url = cleanUrl(url);
  // same page again → update that clip in place
  const key = normUrl(url);
  const queue0 = await get('queue');
  const existing = queue0.find((j) => normUrl(j.url) === key);
  if (existing) return updateClip(existing, { windowId, url, title, tags, note });
  const known = (await get('index'))[key];
  const coll = known ? known.collection : collectionSlug(collection || 'inbox');
  const root = await libraryRoot();
  const clippedAt = known ? known.clippedAt : localIso();
  const folder = known ? known.folder : clipFolder(url, clippedAt);
  const job = {
    id: crypto.randomUUID(), url, title, collection: coll,
    tags: [...new Set([...(known?.tags || []), ...(tags || [])])], note: cleanNote(note) || known?.note || '',
    clippedAt, folder, dir: known ? known.dir : `${root}/${coll}/${folder}`, status: 'queued', attempts: 0, seen: false,
    updatedAt: known ? localIso() : undefined,
  };
  // what you actually saw, right now — the deferred pass may get a different page later
  let seen;
  try { seen = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }); } catch {}
  job.md = buildStub({ ...job, seen: !!seen });
  const files = [{ path: `${job.dir}/clip.md`, text: job.md }];
  if (seen) { files.push({ path: `${job.dir}/seen.jpg`, base64: seen.split(',')[1], mime: 'image/jpeg' }); job.seen = true; }
  // the library carries its own instructions for any agent: AGENTS.md = the artspo skill, minus frontmatter.
  // Rewritten whenever the extension version changes, so the guide never drifts from the format.
  const version = chrome.runtime.getManifest().version;
  const guideKey = `${version}@${root}`;
  if ((await get('guideVersion')) !== guideKey) files.push({ path: `${root}/AGENTS.md`, text: await agentsGuide() });
  const written = await writeFiles(files);
  await set({ guideVersion: guideKey });
  job.localPath = written[0]?.replace(/[\\/]clip\.md$/, '');

  const collections = await get('collections');
  if (!collections.includes(coll)) collections.push(coll);
  const queue = await get('queue');
  queue.unshift(job);
  await set({ queue, collections, lastCollection: coll });
  await remember(job);
  broadcast();
  return { ...job, updated: !!known };
}

async function updateClip(j, { windowId, title, tags, note }) {
  if (j.status === 'running') throw new Error('This page is being inspected right now. Try again in a few seconds.');
  let seen;
  try { seen = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }); } catch {}
  const files = [];
  if (seen) files.push({ path: `${j.dir}/seen.jpg`, base64: seen.split(',')[1], mime: 'image/jpeg' });
  const newNote = cleanNote(note);
  const queue = await get('queue');
  const job = queue.find((x) => x.id === j.id);
  Object.assign(job, {
    title: title || job.title, tags: [...new Set([...(job.tags || []), ...(tags || [])])],
    note: newNote || job.note || '', status: 'queued', attempts: 0, error: undefined, updatedAt: localIso(),
    seen: job.seen || !!seen,
  });
  if (job.md && newNote) { job.md = replaceNote(job.md, job.note); files.push({ path: `${job.dir}/clip.md`, text: job.md }); }
  if (files.length) await writeFiles(files);
  queue.splice(queue.indexOf(job), 1);
  queue.unshift(job); // back to the top of the list
  await set({ queue });
  await remember(job);
  broadcast();
  return { ...job, updated: true };
}

// ---------------- inspect (deferred) ----------------
let processing = false;
async function processQueue(reason) {
  if (processing) return;
  processing = true;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    for (;;) {
      const queue = await get('queue');
      const job = [...queue].reverse().find((j) => j.status === 'queued'); // oldest first
      if (!job) break;
      const ok = await runJob(job, reason);
      if (!ok) break; // a retryable failure waits for the next idle window
    }
  } finally {
    clearInterval(keepAlive);
    processing = false;
    // keep the list short: drop old finished jobs
    const queue = await get('queue');
    const done = queue.filter((j) => j.status === 'done' || j.status === 'partial');
    if (done.length > KEEP_DONE) {
      const drop = new Set(done.slice(KEEP_DONE).map((j) => j.id));
      await set({ queue: queue.filter((j) => !drop.has(j.id)) });
    }
    broadcast();
  }
}

async function runJob(job, reason) {
  await updateJob(job.id, { status: 'running', progress: 'starting', attempts: job.attempts + 1, startedAt: Date.now() });
  try {
    const { result, frames, full, diag } = await inspect(job.url, (p) => updateJob(job.id, { progress: p }));
    diag.inspectedAt = localIso();
    diag.trigger = reason;
    const files = [];
    const listed = [];
    if (job.seen) listed.push('seen.jpg — the viewport exactly as it looked when you clipped it');
    if (full) {
      files.push({ path: `${job.dir}/full.jpg`, base64: full, mime: 'image/jpeg' });
      listed.push(`full.jpg — full page at ${diag.viewport.split('×')[0]}px wide${diag.heightCapped ? ' (height capped)' : ''}`);
    }
    frames.forEach((f, i) => files.push({ path: `${job.dir}/filmstrip/${String(i + 1).padStart(2, '0')}.jpg`, base64: f, mime: 'image/jpeg' }));
    if (frames.length) listed.push(`filmstrip/01–${String(frames.length).padStart(2, '0')}.jpg — viewport frames top to bottom during the scroll pass`);
    diag.partial = !result;
    // the note may have been edited while the pass ran
    const latest = (await get('queue')).find((j) => j.id === job.id);
    if (latest) job.note = latest.note;
    const md = buildClipMd(job, result || {}, diag, listed);
    files.push({ path: `${job.dir}/clip.md`, text: md });
    await writeFiles(files);
    await updateJob(job.id, {
      ...(job.fromList && result?.meta?.title ? { title: result.meta.title } : {}),
      status: diag.partial ? 'partial' : 'done', progress: undefined, finishedAt: Date.now(), md,
      summary: { mode: diag.mode, throttled: diag.throttled, fps: [diag.fpsLoad, diag.fpsScroll], libs: result?.libs || [] },
      error: diag.errors.length ? diag.errors.join('; ') : undefined,
    });
    return true;
  } catch (e) {
    const attempts = job.attempts + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    await updateJob(job.id, { status: giveUp ? 'failed' : 'queued', progress: undefined, error: String(e?.message || e) });
    if (giveUp) {
      // leave an honest file behind rather than a stub that says "queued" forever
      const md = buildStub(job).replace('status: queued', 'status: failed')
        .replace(/_Inspection is queued[^\n]*_/, `_Inspection failed after ${attempts} attempts: ${String(e?.message || e)}_`);
      await writeFiles([{ path: `${job.dir}/clip.md`, text: md }]).catch(() => {});
      await updateJob(job.id, { md });
      return true; // move on to the next job
    }
    return false;
  }
}

// ---------------- reconnect a library ----------------
// The options page reads clip.md files from a folder the user picks; this rebuilds the list and the index from them,
// so the extension can be reinstalled or moved without losing track of the library (an unpacked extension's
// storage is tied to its folder). Known pages are merged, never overwritten.
const STATUS = { complete: 'done', partial: 'partial', failed: 'failed', queued: 'queued' };
async function importLibrary(entries) {
  const queue = await get('queue');
  const index = await get('index');
  const collections = await get('collections');
  const root = await libraryRoot();
  let added = 0, merged = 0;
  const byKey = new Map(queue.map((j) => [normUrl(j.url), j]));
  for (const e of entries.sort((a, b) => String(a.clippedAt).localeCompare(String(b.clippedAt)))) {
    const key = normUrl(e.url);
    const coll = collectionSlug(e.collection || 'inbox');
    if (!collections.includes(coll)) collections.push(coll);
    const have = byKey.get(key);
    if (have) {
      if (!have.note && e.note) have.note = e.note;
      have.tags = [...new Set([...(have.tags || []), ...(e.tags || [])])];
      index[key] = indexEntry(have);
      merged++;
      continue;
    }
    const job = {
      id: crypto.randomUUID(), url: e.url, title: e.title, collection: coll, tags: e.tags || [], note: cleanNote(e.note),
      clippedAt: e.clippedAt, folder: e.folder, dir: `${root}/${coll}/${e.folder}`, status: STATUS[e.status] || 'done',
      attempts: 0, seen: !!e.seen, md: e.md, imported: true,
    };
    queue.unshift(job);
    byKey.set(key, job);
    index[key] = indexEntry(job);
    added++;
  }
  queue.sort((a, b) => String(b.clippedAt).localeCompare(String(a.clippedAt)));
  await set({ queue, index, collections });
  broadcast();
  return { ok: true, added, merged };
}

// ---------------- popup API ----------------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'background') return;
  (async () => {
    switch (msg.type) {
      case 'state': {
        const [queue, collections, lastCollection, settings, collectionMeta] = await Promise.all([get('queue'), get('collections'), get('lastCollection'), get('settings'), get('collectionMeta')]);
        return { queue, collections, lastCollection, settings, collectionMeta, processing };
      }
      case 'clip': return { job: await clip(msg.data) };
      case 'lookup': {
        const key = normUrl(msg.url);
        const job = (await get('queue')).find((j) => normUrl(j.url) === key);
        const entry = job || (await get('index'))[key];
        return { existing: entry ? { collection: entry.collection, note: entry.note || '', tags: entry.tags || [], clippedAt: entry.clippedAt, dir: entry.dir, status: job?.status } : null };
      }
      case 'setNote': {
        const queue = await get('queue');
        const j = queue.find((x) => x.id === msg.id);
        if (!j) throw new Error('That clip is no longer in the list');
        j.note = cleanNote(msg.note);
        await remember(j);
        if (j.md) {
          j.md = replaceNote(j.md, j.note);
          await writeFiles([{ path: `${j.dir}/clip.md`, text: j.md }]);
        } else {
          throw new Error('This clip was made by an older version of Artspo. Edit the Note section in its clip.md directly.');
        }
        await set({ queue }); broadcast();
        return { ok: true };
      }
      case 'processNow': processQueue('manual').catch(() => {}); return { ok: true };
      case 'retry':
      case 'reinspect': {
        // same folder, same note and seen.jpg; clip.md, full.jpg and the filmstrip are rewritten
        await updateJob(msg.id, { status: 'queued', attempts: 0, error: undefined, progress: undefined });
        processQueue('manual').catch(() => {});
        return { ok: true };
      }
      case 'reinspectAll': {
        const queue = await get('queue');
        let n = 0;
        for (const j of queue) if (j.status !== 'running' && j.status !== 'queued') { Object.assign(j, { status: 'queued', attempts: 0, error: undefined }); n++; }
        await set({ queue }); broadcast();
        processQueue('manual').catch(() => {});
        return { ok: true, n };
      }
      case 'remove': {
        const queue = (await get('queue')).filter((j) => j.id !== msg.id || j.status === 'running');
        await set({ queue }); broadcast(); return { ok: true };
      }
      case 'settings': {
        const settings = { ...(await get('settings')), ...msg.settings };
        await set({ settings });
        chrome.idle.setDetectionInterval(Math.max(15, settings.idleSeconds));
        return { settings };
      }
      case 'showFolder': chrome.downloads.showDefaultFolder(); return { ok: true };
      case 'openOptions': chrome.runtime.openOptionsPage(); return { ok: true };
      case 'setLibrary': {
        const library = cleanLibrary(msg.library);
        const settings = await get('settings');
        const changed = (settings.library || DEFAULT_LIBRARY) !== library;
        await set({ settings: { ...settings, library } });
        return { library, changed };
      }
      case 'collections': {
        // the list the popup offers; folders on disk are never touched
        let collections = await get('collections');
        let lastCollection = await get('lastCollection');
        const name = msg.name ? collectionSlug(msg.name) : '';
        if (msg.op === 'add' && name && !collections.includes(name)) collections.push(name);
        if (msg.op === 'default' && collections.includes(name)) lastCollection = name;
        if (msg.op === 'remove') {
          const queue = await get('queue');
          if (queue.some((j) => j.collection === name)) throw new Error(`${name} has clips in the list. Remove those first, or keep the collection.`);
          collections = collections.filter((c) => c !== name);
          if (!collections.length) collections = ['inbox'];
          if (lastCollection === name) lastCollection = collections[0];
        }
        await set({ collections, lastCollection });
        broadcast();
        return { collections, lastCollection };
      }
      case 'importLibrary': return importLibrary(msg.entries || []);
      case 'saveCollection': return saveCollection(msg);
      case 'addLinks': return addLinks(msg);
      case 'openCatalogue': {
        // catalogue.html is built by your agent (skills/artspo/catalogue.py) at the library root
        const lp = ((await get('queue')) || []).map((j) => j.localPath).find(Boolean);
        if (!lp) return { error: 'Clip something first, then ask your agent to build the catalogue.' };
        const sep = lp.includes('\\') ? '\\' : '/';
        const path = lp.split(/[\\/]/).slice(0, -2).join(sep) + sep + 'catalogue.html';
        const url = 'file://' + (path.startsWith('/') ? '' : '/') + encodeURI(path.replace(/\\/g, '/'));
        try { await chrome.tabs.create({ url }); return { ok: true }; } catch {
          return { error: 'Chrome won’t let the extension open local files yet. Turn on “Allow access to file URLs” in Artspo’s details on the extensions page, or open this file:', path };
        }
      }
    }
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});

// exposed for tests and the console
globalThis.artspo = { clip, processQueue, get, set, dedupe };
init();
