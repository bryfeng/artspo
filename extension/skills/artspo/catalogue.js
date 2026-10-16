(() => {
const D = JSON.parse(document.getElementById('data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const LAYER = { work: 'work', language: 'pattern', technique: 'pattern', clip: 'clip' };
const LETTER = { work: 'W', pattern: 'P', clip: 'C' };
const FACETS = [['color', 'Color'], ['type', 'Type'], ['shape', 'Shape & depth'], ['layout', 'Layout & structure'], ['motion', 'Motion']];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ================================================================ index + lineage
const items = new Map();
const idOf = (layer, key) => `${LETTER[layer].toLowerCase()}.${key}`;
for (const c of D.clips) { c.id = idOf('clip', c.key); items.set(c.id, c); }
for (const p of D.patterns) { p.id = idOf('pattern', p.key); items.set(p.id, p); }
for (const w of D.works) { w.id = idOf('work', w.key); items.set(w.id, w); }
const pat = (k) => items.get(idOf('pattern', k));
const clip = (k) => items.get(idOf('clip', k));
const rel = new Map();
const link = (a, b, ab, ba) => { if (!a || !b) return; (rel.get(a.id) || rel.set(a.id, new Map()).get(a.id)).set(b.id, ab); (rel.get(b.id) || rel.set(b.id, new Map()).get(b.id)).set(a.id, ba); };
for (const p of D.patterns) {
  for (const k of p.evidence) link(p, clip(k), 'Evidence', 'Cited by');
  for (const k of p.partial || []) link(p, clip(k), 'Evidence (partly)', 'Cited by');
  for (const l of p.languages || []) link(p, pat(l), 'Part of', 'Techniques');
}
for (const w of D.works) {
  for (const k of w.patterns) link(w, pat(k), 'Made from', 'Used in');
  for (const k of w.clips) link(w, clip(k), 'Drew on', 'Used in');
}
const near = (id) => rel.get(id) || new Map();
function traced(id) {
  const it = items.get(id), out = new Set([id]);
  for (const [o] of near(id)) out.add(o);
  if (it.type === 'work') for (const [p] of near(id)) if (items.get(p)?.type !== 'clip') for (const [c] of near(p)) if (items.get(c)?.type === 'clip') out.add(c);
  if (it.type === 'clip') for (const [p] of near(id)) for (const [w] of near(p)) if (items.get(w)?.type === 'work') out.add(w);
  return out;
}
const usedIn = (it) => [...near(it.id)].filter(([o]) => items.get(o)?.type === 'work').length;

// ================================================================ small helpers
function genericFamily(name) {
  const n = String(name).toLowerCase();
  if (/mono|code|courier|consol|menlo/.test(n)) return 'ui-monospace, Menlo, monospace';
  if (!/sans/.test(n) && /serif|ivy|reckless|iowan|garamond|times|georgia|tiempos|canela|caslon|baskerville|didot|bodoni|playfair|charter|lora|merriweather|newsreader|fraunces/.test(n)) return '"Iowan Old Style", Georgia, serif';
  return '"Helvetica Neue", Helvetica, Arial, sans-serif';
}
const fontStack = (name) => `"${String(name).replace(/"/g, '')}", ${genericFamily(name)}`;
function lum(c) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(c || '').trim());
  if (!m) return 0.5;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const onColor = (c) => (lum(c) > 0.4 ? '#111' : '#fff');
function copy(text, btn) {
  const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = t), 1400); };
  try { navigator.clipboard.writeText(text).then(done, () => {}); } catch {}
}
function mdLite(text, cls) {
  const box = el('div', cls);
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const p = el('p'); const parts = line.replace(/^- /, '• ').split(/\*\*(.+?)\*\*/);
    parts.forEach((s, i) => p.append(i % 2 ? el('b', '', s) : document.createTextNode(s.replace(/`/g, ''))));
    box.append(p);
  }
  return box;
}
function img(src, alt, cls) { const i = el('img', cls); i.src = src; i.alt = alt || ''; i.loading = 'lazy'; i.decoding = 'async'; return i; }
function blk(title, right) {
  const b = el('section', 'blk'), h = el('h3', 'blk-h', title);
  if (right) { right.classList.add('grow'); h.append(right); }
  b.append(h); return b;
}

// specimens render in a shadow root so their CSS stays scoped
const FREEZE = '<style>*,*::before,*::after{animation-delay:-60s!important;animation-iteration-count:1!important;transition:none!important}</style>';
function specimenHost(html, { frozen = false } = {}) {
  const host = el('div', 'spec-host');
  const root = host.attachShadow({ mode: 'open' });
  const paint = () => { root.innerHTML = (frozen || REDUCED ? FREEZE : '') + html; };
  paint(); host.replay = paint; return host;
}
function mini(html) {
  const box = el('div', 'mini'); const host = specimenHost(html, { frozen: true });
  host.style.width = '760px'; host.style.transformOrigin = '0 0';
  box.append(host);
  const fit = () => { const k = box.clientWidth / 760 || 0.3; host.style.transform = `scale(${k})`; box.style.height = Math.round(340 * k * 0.62) + 'px'; };
  new ResizeObserver(fit).observe(box);
  return box;
}

// ================================================================ cards
function swatches(list) { const s = el('div', 'sw'); for (const h of list) { const i = el('i'); i.style.background = h; s.append(i); } return s; }
function shot(src, alt) { return src ? img(src, alt, 'shot') : el('div', 'shot blank mono', 'no preview'); }
// in a book without screenshots a clip shows its measured surfaces, by share of the page
function chips(k) {
  const box = el('div', 'shot chips-shot');
  const surf = k.sheet.surfaces.filter((x) => x.c);
  for (const x of surf.length ? surf : k.swatches.map((c) => ({ c, pct: 1 }))) { const d = el('i'); d.style.background = x.c; d.style.flex = `${Math.max(x.pct, 4)} 1 0`; box.append(d); }
  const t = s0(k); if (t) { const b = el('b', '', 'Aa'); b.style.cssText = `font-family:${fontStack(t.family)};font-weight:${t.weight};color:${t.c}`; box.append(b); }
  return box;
}
function s0(k) { const s = k.sheet; const f = s.display || s.scale?.[0]; if (!f) return null; const bg = s.surfaces.find((x) => x.c)?.c || '#fff'; return { family: f.family, weight: f.weight, c: (s.text.find((t) => Math.abs(lum(t.c) - lum(bg)) > 0.3) || s.text[0])?.c || onColor(bg) }; }
function head(it, layer, right) {
  const r = el('div', 'row');
  r.append(el('span', `idx ${layer}`, LETTER[layer]), el('span', 'acc mono', it.key));
  if (right) { right.classList.add('grow'); r.append(right); }
  return r;
}
function card(it, cls = '') {
  const c = el('article', `card ${cls}${it.starred ? ' star' : ''}`);
  c.tabIndex = 0; c.dataset.id = it.id; c.setAttribute('role', 'button'); c.setAttribute('aria-label', 'Open ' + it.title);
  c.addEventListener('click', () => openViewer(it.id));
  c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(it.id); } });
  return c;
}
function workCard(w) {
  const c = card(w), b = el('div', 'body');
  b.append(head(w, 'work', el('span', `pill ${w.status}`, w.status || 'draft')), el('h3', '', w.title));
  if (w.summary) b.append(el('p', '', w.summary));
  const np = w.patterns.length, nc = [...traced(w.id)].filter((o) => items.get(o).type === 'clip').length;
  b.append(el('div', 'lineage', `${w.kind || 'work'} · ${np} pattern${np === 1 ? '' : 's'} · ${nc} clip${nc === 1 ? '' : 's'}${w.made_by ? ' · by ' + w.made_by : ''}`));
  if (w.verdict) b.append(el('div', 'note', '“' + w.verdict.split('\n')[0] + '”'));
  c.append(shot(w.img, w.title), b); return c;
}
function langCard(l) {
  const c = card(l), b = el('div', 'body');
  b.append(head(l, 'pattern', el('span', `pill ${l.status}`, l.status)));
  if (l.specimen) b.append(mini(l.specimen));
  b.append(el('h3', '', l.title));
  if (l.from_book) b.append(el('div', 'from mono', `from ${l.from_book}`));
  if (l.swatches.length) b.append(swatches(l.swatches));
  b.append(el('p', '', l.summary));
  const t = el('div', 'thumbs');
  for (const k of [...l.evidence, ...(l.partial || [])].slice(0, 5)) { const cl = clip(k); if (cl?.img) t.append(img(cl.img, cl.title)); }
  const n = usedIn(l), r = el('div', 'row');
  r.append(t, el('span', 'lineage grow', l.from_book && !l.evidence.length ? (n ? `used in ${n}` : '') : `${l.evidence.length} clip${l.evidence.length === 1 ? '' : 's'}${n ? ' · used in ' + n : ''}`));
  b.append(r);
  c.append(b); return c;
}
function techCard(t) {
  const c = card(t, 'tech'), b = el('div', 'body');
  const r = el('div', 'row'); r.append(el('span', 'idx pattern', 'P'), el('span', 'acc mono', t.facet), el('span', `pill ${t.status} grow`, t.status));
  b.append(r);
  if (t.specimen) b.append(mini(t.specimen));
  b.append(el('h3', '', t.title));
  if (t.from_book) b.append(el('div', 'from mono', `from ${t.from_book}`));
  b.append(el('p', '', t.summary));
  const n = usedIn(t);
  const nc = t.from_book && !t.evidence.length ? '' : `${t.evidence.length} clip${t.evidence.length === 1 ? '' : 's'}`;
  b.append(el('div', 'lineage', [nc, n ? `used in ${n} work${n === 1 ? '' : 's'}` : '', t.starred ? 'starred' : ''].filter(Boolean).join(' · ')));
  c.append(b); return c;
}
function clipCard(k) {
  const c = card(k), b = el('div', 'body');
  const short = k.title.length > 60 ? k.title.slice(0, 60).replace(/\s+\S*$/, '') + '…' : k.title;
  b.append(head(k, 'clip'), el('h3', '', short), el('div', 'acc mono', k.host));
  if (k.swatches.length) b.append(swatches(k.swatches));
  if (k.note) b.append(el('div', 'note', k.note)); else if (!D.public) b.append(el('div', 'note empty', 'No note yet'));
  const np = near(k.id).size, nm = k.sheet.motion.length;
  b.append(el('div', 'lineage', `cited by ${np} pattern${np === 1 ? '' : 's'} · ${nm} motion${nm === 1 ? '' : 's'}${k.frames.length ? ' · ' + k.frames.length + ' frames' : ''}`));
  c.append(k.img || !D.public ? shot(k.img, k.title + ' as it looked when clipped') : chips(k), b); return c;
}

// ================================================================ grid
const works = D.works, langs = D.patterns.filter((p) => p.type === 'language'), techs = D.patterns.filter((p) => p.type === 'technique');
const starFirst = (a, b) => (b.starred - a.starred);
$('#n-work').textContent = works.length; $('#n-pattern').textContent = D.patterns.length; $('#n-clip').textContent = D.clips.length;
const gw = $('#g-works');
works.slice().sort(starFirst).forEach((w) => gw.append(workCard(w)));
if (!D.public) {
  const e = el('div', 'empty-card');
  e.append(el('b', '', works.length ? 'Make another' : 'Nothing made yet'), el('span', '', 'Ask your agent, naming patterns or clips:'),
    el('code', '', 'Make a motion spec from soft-rise-reveal and motion-timing-tiers'), el('code', '', 'Landing page for X in research-index, with highlighter-marks'),
    el('span', '', 'Or add your own: a folder in works/ with a work.md.'));
  gw.append(e);
}
langs.slice().sort(starFirst).forEach((l) => $('#g-languages').append(langCard(l)));
for (const [f, name] of FACETS) {
  const list = techs.filter((t) => t.facet === f).sort(starFirst);
  if (!list.length) continue;
  const g = el('div', 'grid tight'); list.forEach((t) => g.append(techCard(t)));
  $('#g-techniques').append(el('div', 'sub', `Techniques · ${name}`), g);
}
D.clips.slice().sort((a, b) => b.clipped.localeCompare(a.clipped)).forEach((k) => $('#g-clips').append(clipCard(k)));
const foot = $('#foot');
foot.append(el('span', 'mono', D.public ? `Built ${D.built}` : `Built ${D.built} from ${D.library}`));
if (D.public) foot.append(el('span', '', D.clips.some((k) => k.img) ? 'Screenshots and measurements belong to the sites they came from and are shown for reference, with links. Patterns, specimens and works are our own.' : 'Measurements come from the sites named, with links. Patterns, specimens and works are our own.'));
if (D.book) { const a = el('a', 'mono', 'artbook.md'); a.href = 'artbook.md'; foot.append(a); }
if (D.superseded) foot.append(el('span', 'mono', `${D.superseded} superseded clip${D.superseded === 1 ? '' : 's'} hidden`));
foot.append(el('span', 'mono', D.public ? 'Made with Artspo' : 'Rebuild: python3 catalogue.py'));
if (D.title) { const b = document.querySelector('.brand'); b.textContent = ''; b.append(el('b', '', D.title), el('span', '', D.book ? 'an Artspo book' : 'an Artspo catalogue')); document.title = D.title; }

let layer = 'all', q = '', starOnly = false, coll = D.scope || '', inColl = null;
// a collection is a project: its clips, the works made for it, and the patterns they touch
function collectionSet(c) {
  if (!c) return null;
  const set = new Set();
  for (const k of D.clips) if (k.collection === c) set.add(k.id);
  for (const w of D.works) if (w.collection === c || w.clips.some((x) => set.has(idOf('clip', x)))) set.add(w.id);
  for (const id of [...set]) for (const [o] of near(id)) if (items.get(o).type !== 'clip' && items.get(o).type !== 'work') set.add(o);
  return set;
}
function useBook(box) {
  const u = el('div', 'use');
  const t = el('div', 'use-t');
  t.append(el('b', '', 'Take anything here to your own AI.'), el('span', '', ' Open a pattern or work and press Copy prompt, or give your agent the whole book:'));
  const line = `Use ${D.url || location.href.replace(/[#?].*$/, '').replace(/index\.html$/, '')}artbook.md as your design reference.`;
  const row = el('div', 'path'); const code = el('code', '', line);
  const cp = el('button', 'btn', 'Copy'); cp.type = 'button'; cp.addEventListener('click', () => copy(line, cp));
  const a = el('a', 'btn', 'artbook.md'); a.href = 'artbook.md'; a.target = '_blank';
  row.append(code, cp, a); u.append(t, row); box.append(u);
}
function renderBrief() {
  const box = $('#brief'); box.textContent = '';
  const c = (D.collections || []).find((x) => x.key === coll);
  box.hidden = !c && !D.book;
  if (!c) { if (D.book) useBook(box); return; }
  const head = el('div', 'brief-h');
  head.append(el('span', 'mono', `collection · ${c.key}`), el('h2', '', c.title));
  box.append(head);
  box.append(c.brief ? el('p', 'brief-t', c.brief) : el('p', 'note empty', D.public ? '' : 'No brief yet. Add one in Artspo setup: what is this collection for?'));
  const n = D.clips.filter((k) => k.collection === c.key).length, nw = D.works.filter((w) => inColl.has(w.id)).length;
  box.append(el('div', 'lineage', `${n} clip${n === 1 ? '' : 's'} · ${nw} work${nw === 1 ? '' : 's'}${c.links.length ? ` · ${c.links.length} added as a list` : ''}`));
  if (D.book) useBook(box);
}
{
  const sel = $('#coll');
  const cs = D.collections || [];
  if (cs.length > 1 && !D.scope) {
    sel.hidden = false;
    sel.append(new Option('All collections', ''));
    for (const c of cs) sel.append(new Option(`${c.title} · ${c.clips}`, c.key));
    sel.addEventListener('change', () => { coll = sel.value; inColl = collectionSet(coll); renderBrief(); applyFilters(); });
  }
  inColl = collectionSet(coll);
  renderBrief();
}
const hay = (it) => [it.title, it.key, it.summary, it.note, it.host, it.tagline, it.kind, it.facet, (it.tags || []).join(' ')].join(' ').toLowerCase();
function applyFilters() {
  for (const c of document.querySelectorAll('.card')) {
    const it = items.get(c.dataset.id);
    c.classList.toggle('filtered-out', !((!q || hay(it).includes(q)) && (!starOnly || it.starred) && (!inColl || inColl.has(it.id))));
  }
  for (const s of document.querySelectorAll('main > section[data-layer]')) {
    s.hidden = !(layer === 'all' || s.dataset.layer === layer) || (D.public && !s.querySelector('.card'));
    let msg = s.querySelector(':scope > .none');
    const any = s.querySelector('.card:not(.filtered-out)') || (!q && !starOnly && s.querySelector('.empty-card'));
    const EMPTY = { pattern: 'No patterns yet. Ask your agent: “Analyze my artspo library into patterns, then build the catalogue.”', clip: 'No clips yet. Clip a site with the Artspo extension (Alt+Shift+S).', work: 'Nothing made yet.' };
    const text = starOnly ? 'Nothing starred here. Star something by setting starred: true in its file.' : !s.querySelector('.card') ? EMPTY[s.dataset.layer] : 'No matches.';
    if (!any && !msg) { msg = el('div', 'none'); s.append(msg); }
    if (any && msg) msg.remove(); else if (msg) msg.textContent = text;
  }
  for (const sub of document.querySelectorAll('#g-techniques .sub')) { const g = sub.nextElementSibling; const vis = !!g.querySelector('.card:not(.filtered-out)'); sub.hidden = !vis; g.hidden = !vis; }
  const lv = $('#g-languages'); $('#patterns > .sub').hidden = lv.hidden = !lv.querySelector('.card:not(.filtered-out)');
}
document.querySelectorAll('.tab[data-layer]').forEach((t) => t.addEventListener('click', () => {
  layer = t.dataset.layer; document.querySelectorAll('.tab[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x === t))); applyFilters();
}));
$('#q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); applyFilters(); });
$('#starred').addEventListener('click', (e) => { starOnly = !starOnly; e.currentTarget.setAttribute('aria-pressed', String(starOnly)); applyFilters(); });

// tracing on the table (shown after closing the viewer)
let traceId = null, traceBar = null;
function trace(id) {
  traceId = id;
  document.body.classList.toggle('tracing', !!id);
  const set = id ? traced(id) : new Set();
  for (const c of document.querySelectorAll('.card')) { c.classList.toggle('sel', c.dataset.id === id); c.classList.toggle('rel', !!id && set.has(c.dataset.id) && c.dataset.id !== id); }
  traceBar?.remove(); traceBar = null;
  if (!id) return;
  traceBar = el('div', 'trace-bar');
  const clear = el('button', '', 'Clear'); clear.type = 'button'; clear.addEventListener('click', () => trace(null));
  traceBar.append(el('span', '', `Tracing ${items.get(id).title.slice(0, 40)} · ${set.size - 1} linked`), clear);
  document.body.append(traceBar);
}
document.addEventListener('click', (e) => { if (traceId && $('#viewer').hidden && !e.target.closest('.card, header, .trace-bar')) trace(null); });

// ================================================================ viewer
const V = { id: null, tab: null, order: [] };
const TABS = {
  clip: D.public ? [['elements', 'Elements'], ['screens', 'Screen']] : [['elements', 'Elements'], ['screens', 'Screens'], ['record', 'Record']],
  pattern: [['specimen', 'Specimen'], ['evidence', 'Evidence'], ['recipe', 'Recipe']],
  work: [['preview', 'Preview'], ['files', 'Files']],
};
const tabsFor = (it) => TABS[LAYER[it.type]].filter(([k]) => k !== 'screens' || it.img || it.frames.length || it.full);
const visibleOrder = () => [...document.querySelectorAll('main > section[data-layer]:not([hidden]) .card:not(.filtered-out)')].map((c) => c.dataset.id);
function openViewer(id, tab) {
  const it = items.get(id); if (!it) return;
  const L = LAYER[it.type];
  if (!V.id) V.order = visibleOrder();
  if (!V.order.includes(id)) V.order = visibleOrder().includes(id) ? visibleOrder() : [...V.order, id];
  V.id = id; V.tab = tab && tabsFor(it).some(([k]) => k === tab) ? tab : tabsFor(it)[0][0];
  const v = $('#viewer'); v.hidden = false; document.body.classList.add('viewing');
  const ix = $('#v-idx'); ix.className = `idx ${L}`; ix.textContent = LETTER[L];
  $('#v-kind').textContent = it.type === 'technique' ? `technique · ${it.facet}` : it.type === 'work' ? `work · ${it.kind || ''}` : it.type === 'clip' ? `clip · ${it.host}` : 'language';
  $('#v-title').textContent = it.title;
  const pos = V.order.indexOf(id);
  $('#v-pos').textContent = `${pos + 1} / ${V.order.length}`;
  const tabs = $('#v-tabs'); tabs.textContent = '';
  tabsFor(it).forEach(([k, name], i) => {
    const b = el('button', 'tab', name); b.type = 'button'; b.setAttribute('aria-selected', String(k === V.tab)); b.title = `${name} (${i + 1})`;
    b.addEventListener('click', () => openViewer(id, k)); tabs.append(b);
  });
  renderStage(it, V.tab);
  renderSide(it);
  try { history.replaceState(null, '', '#' + id); } catch {}
}
function closeViewer() {
  const id = V.id; V.id = null;
  stopAll();
  $('#viewer').hidden = true; document.body.classList.remove('viewing');
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  if (id) { trace(id); document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }); }
}
function step(d) { if (!V.id) return; const i = V.order.indexOf(V.id); const n = V.order[(i + d + V.order.length) % V.order.length]; openViewer(n); }
$('#v-prev').addEventListener('click', () => step(-1));
$('#v-next').addEventListener('click', () => step(1));
$('#v-close').addEventListener('click', closeViewer);
document.addEventListener('keydown', (e) => {
  if ($('#viewer').hidden) { if (e.key === 'Escape' && traceId) trace(null); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
  else if (!typing && e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (!typing && /^[1-3]$/.test(e.key)) { const t = tabsFor(items.get(V.id))[+e.key - 1]; if (t) openViewer(V.id, t[0]); }
});

function chipFor(id) {
  const it = items.get(id), b = el('button', 'chip'); b.type = 'button';
  b.append(el('span', `idx ${LAYER[it.type]}`, LETTER[LAYER[it.type]]), document.createTextNode(it.title.length > 40 ? it.title.slice(0, 38) + '…' : it.title));
  b.addEventListener('click', () => openViewer(id));
  return b;
}
function meta(pairs) {
  const dl = el('dl', 'd-meta');
  for (const [k, v] of pairs) { if (!v) continue; dl.append(el('dt', '', k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); }
  return dl;
}
function promptBox(it) {
  const box = el('div', 'prompt');
  const cp = el('button', 'btn primary', 'Copy prompt'); cp.type = 'button'; cp.addEventListener('click', () => copy(it.prompt, cp));
  const peek = el('button', 'btn', 'Show'); peek.type = 'button';
  const pre = el('pre', 'code', it.prompt); pre.hidden = true;
  peek.addEventListener('click', () => { pre.hidden = !pre.hidden; peek.textContent = pre.hidden ? 'Show' : 'Hide'; });
  const r = el('div', 'row'); r.append(cp, peek);
  box.append(r, el('div', 'hint', it.type === 'work' ? 'Paste into any AI to make your own in this spirit: the brief, the reasoning and every pattern it used.' : 'Paste into any AI: the whole pattern, its tokens or recipe, and a reference specimen.'), pre);
  return box;
}
function renderSide(it) {
  const side = $('#v-side'); side.textContent = '';
  if (it.prompt) side.append(promptBox(it));
  if (it.type === 'clip') {
    const a = el('a', '', it.host); a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
    if (it.note) side.append(el('p', 'verdict', it.note)); else if (!D.public) side.append(el('p', 'note empty', 'No note yet. Add one from the extension popup: it tells your agent why you saved this.'));
    if (it.tagline) side.append(el('p', '', it.tagline));
    side.append(meta([['site', a], ['clipped', it.clipped], ['inspected', it.inspected], ['libraries', it.sheet.libs || (it.libs || []).join(', ')], ['tags', (it.tags || []).join(', ')]]));
  } else if (it.type === 'work') {
    if (it.verdict) side.append(el('p', 'verdict', it.verdict)); else if (!D.public) side.append(el('p', 'note empty', 'No verdict yet. Write yours under ## Verdict in work.md, and set status to kept, shipped or dropped.'));
    if (it.summary) side.append(el('p', '', it.summary));
    side.append(meta([['status', it.status], ['kind', it.kind], ['made', it.made], ['by', it.made_by]]));
  } else {
    side.append(el('p', '', it.summary));
    let from = it.from_book;
    if (from && /^https?:/.test(it.source)) { from = el('a', '', it.from_book); from.href = it.source; from.target = '_blank'; from.rel = 'noopener'; }
    side.append(meta([['from', from], ['status', it.status], ['facet', it.facet], ['updated', it.updated], ['starred', it.starred ? 'yes' : '']]));
  }
  const groups = new Map();
  for (const [o, label] of near(it.id)) (groups.get(label) || groups.set(label, []).get(label)).push(o);
  if (it.type === 'work') { const via = [...traced(it.id)].filter((o) => items.get(o).type === 'clip' && !near(it.id).has(o)); if (via.length) groups.set('Clips behind those patterns', via); }
  if (it.type === 'clip') { const via = [...traced(it.id)].filter((o) => items.get(o).type === 'work' && !near(it.id).has(o)); if (via.length) groups.set('Used in (through patterns)', via); }
  for (const [label, ids] of groups) {
    const g = el('div', 'd-group'); g.append(el('h4', '', `${label} · ${ids.length}`));
    const ch = el('div', 'chips'); ids.forEach((o) => ch.append(chipFor(o))); g.append(ch); side.append(g);
  }
  if (!groups.size) side.append(el('p', 'note empty', it.type === 'clip' ? 'No pattern cites this clip yet. Ask your agent to analyze the library.' : 'Not linked to anything yet.'));
  if (!it.path) return;
  const path = el('div', 'path'), code = el('code', '', it.path);
  const cp = el('button', 'btn', 'Copy path'); cp.type = 'button'; cp.addEventListener('click', () => copy(it.path, cp));
  path.append(code, cp);
  if (!D.embedded) { const a = el('a', 'btn', 'Open file'); a.href = it.path; a.target = '_blank'; path.append(a); }
  side.append(path);
}

let running = [];
function stopAll() { running.forEach((a) => { try { a.cancel(); } catch {} }); running = []; }
function renderStage(it, tab) {
  stopAll();
  const st = $('#v-stage'); st.textContent = ''; st.scrollTop = 0;
  if (it.type === 'clip') ({ elements: clipElements, screens: clipScreens, record: clipRecord })[tab](it, st);
  else if (it.type === 'work') ({ preview: workPreview, files: workFiles })[tab](it, st);
  else ({ specimen: patSpecimen, evidence: patEvidence, recipe: patRecipe })[tab](it, st);
}

// ---------------------------------------------------------------- clip: elements
function clipElements(k, st) {
  const s = k.sheet;
  const surf = s.surfaces.filter((x) => x.c);
  const bg = surf[0]?.c || '#ffffff';
  const fg = (s.text.find((t) => Math.abs(lum(t.c) - lum(bg)) > 0.3) || s.text[0])?.c || onColor(bg);
  const dark = surf.slice().sort((a, b) => lum(a.c) - lum(b.c))[0]?.c || '#111';
  // a color that reads on the light table: the site's accent if it has one, else its ink
  const solid = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
  const accent = [...s.accents.map((a) => a.c), ...s.buttons.filter((b) => b.filled).map((b) => b.fill), fg, dark].find((c) => solid(c) && lum(c) < 0.75) || '#4E5661';

  // palette
  const pb = blk('Palette', el('span', 'hint', 'surfaces by share of the page · text by amount of text'));
  const strip = el('div', 'strip');
  for (const x of s.surfaces) {
    const d = el('div', x.c ? '' : 'img'); d.style.flex = `${Math.max(x.pct, 1.5)} 1 0`;
    if (x.c) { d.style.background = x.c; d.style.color = onColor(x.c); }
    d.textContent = `${x.c ? x.label : 'imagery'} ${x.pct}%`; d.title = d.textContent; strip.append(d);
  }
  pb.append(strip);
  const inks = el('div', 'inks');
  for (const t of s.text) { const d = el('div', 'ink'), b = el('b', '', 'Aa'); b.style.color = t.c; b.style.background = bg; d.append(b, el('span', 'mono', `${t.label} · ${t.pct}%`)); inks.append(d); }
  pb.append(inks);
  if (s.accents.length) {
    const a = el('div', 'acc-sw');
    for (const x of s.accents) { const d = el('div'), i = el('i'); i.style.background = x.c; d.append(i, el('span', 'mono', `${x.c} · “${x.eg}”`)); a.append(d); }
    pb.append(el('div', 'hint', 'Accent candidates (from buttons and calls to action)'), a);
  }
  st.append(pb);

  // type
  const tb = blk('Type', el('span', 'hint', s.webfonts ? `site webfonts: ${s.webfonts}` : ''));
  const spec = el('div', 'tspec'); spec.style.background = bg; spec.style.color = fg;
  const lines = [];
  if (s.display) lines.push({ px: s.display.px, weight: s.display.weight, family: s.display.family, sample: s.display.sample || 'Display', ls: s.display.ls, lh: s.display.lh, upper: s.display.upper, tag: 'display' });
  for (const x of s.scale) if (!s.display || Math.abs(x.px - s.display.px) > 0.5 || x.family !== s.display.family) lines.push({ ...x, ls: 0, lh: 1.15 });
  if (s.body) lines.push({ px: s.body.px, weight: 400, family: s.body.family, sample: 'Body copy sits here, set at the measured size and leading so you can feel the rhythm of the page.', ls: 0, lh: s.body.lh / s.body.px, tag: 'body' });
  for (const x of lines) {
    const r = el('div', 'tline'), t = el('div', 't', x.sample.trim());
    t.style.cssText = `font-family:${fontStack(x.family)};font-size:${Math.min(x.px, 160)}px;font-weight:${x.weight};letter-spacing:${x.ls || 0}em;line-height:${x.lh || 1.15};${x.upper ? 'text-transform:uppercase;' : ''}`;
    if (x.tag === 'body') { t.style.whiteSpace = 'normal'; t.style.maxWidth = '62ch'; }
    r.append(el('div', 'k', `${x.px}px · ${x.weight}${x.tag ? ' · ' + x.tag : ''}\n${x.family}${x.ls ? '\n' + x.ls + 'em' : ''}`), t);
    r.firstChild.style.whiteSpace = 'pre-line';
    spec.append(r);
  }
  tb.append(spec);
  if (s.families.length) {
    const f = el('div', 'fams');
    s.families.forEach((x, i) => { const d = el('div', '', `${x.name} ${x.pct}%`); d.style.flex = `${x.pct} 1 0`; d.style.background = `color-mix(in srgb, var(--ink) ${85 - i * 18}%, var(--ground))`; f.append(d); });
    tb.append(f);
  }
  tb.append(el('div', 'hint', 'Rendered with the fonts on this computer. The site’s own font shows only if you have it installed; otherwise a similar system face stands in.'));
  st.append(tb);

  // buttons
  if (s.buttons.length) {
    const bb = blk('Buttons', el('span', 'hint', 'rebuilt from measured fill, text, radius, padding, size and height'));
    const lightText = s.buttons.some((b) => lum(b.text) > 0.6 && (!b.filled || lum(b.fill) > 0.6 && /[0-9a-f]{8}$/i.test(b.fill)));
    const back = el('div', 'backdrop btns'); back.style.background = lightText ? dark : bg;
    for (const b of s.buttons) {
      const w = el('div', 'rb'), btn = el('button', '', b.labels[0] || 'Button'); btn.type = 'button'; btn.tabIndex = -1;
      const pad = b.padding === '0px 0px' ? '0 14px' : b.padding;
      btn.style.cssText = `background:${b.filled ? b.fill : 'transparent'};color:${b.text};border-radius:${b.radius};padding:${pad};font:${b.weight} ${b.size}px/1 ${fontStack(s.body?.family || s.display?.family || 'sans-serif')};${b.height ? 'height:' + b.height + 'px;' : ''}border:${b.border ? b.border.replace(/^(\d+px) /, '$1 solid ') : '0'};`;
      const k = el('span', 'k', `${b.filled ? 'filled' : 'outline'} · r ${b.radius} · ${b.size}px/${b.weight}${b.height ? ' · ' + b.height + 'px' : ''}`); k.style.color = lum(back.style.background) < 0.3 || lightText ? '#ddd' : '#555';
      w.append(btn, k); back.append(w);
    }
    bb.append(back); st.append(bb);
  }

  // shape
  if (s.radii.length || s.shadows.length || s.borders.length) {
    const sb = blk('Shape & depth', el('span', 'hint', s.spacing ? 'spacing: ' + s.spacing : ''));
    if (s.radii.length) {
      const t = el('div', 'tiles');
      for (const r of s.radii) { const d = el('div', 'tile'), q = el('div', 'sq'); q.style.borderRadius = r.v; q.style.background = accent; d.append(q, el('span', 'k', `${r.v} · ${r.n}×${r.eg ? ' · ' + r.eg : ''}`)); t.append(d); }
      sb.append(el('div', 'hint', 'Radii'), t);
    }
    if (s.shadows.length) {
      const t = el('div', 'backdrop'); t.style.background = bg;
      for (const r of s.shadows) { const d = el('div', 'tile'), q = el('div', 'sq big'); q.style.boxShadow = r.v; q.style.background = surf[1]?.c && lum(surf[1].c) > lum(bg) ? surf[1].c : bg; q.style.borderRadius = (s.radii[0]?.v || '0').split(' ')[0]; const kk = el('span', 'k', `${r.v} · ${r.n}×`); kk.style.color = onColor(bg) === '#fff' ? '#ccc' : '#555'; d.append(q, kk); t.append(d); }
      sb.append(el('div', 'hint', 'Shadows'), t);
    }
    if (s.borders.length) {
      const t = el('div', 'backdrop'); t.style.background = bg;
      for (const r of s.borders) { const d = el('div', 'tile'), q = el('div', 'sq big'); q.style.border = r.v; q.style.background = 'transparent'; const kk = el('span', 'k', `${r.v} · ${r.n}×`); kk.style.color = onColor(bg) === '#fff' ? '#ccc' : '#555'; d.append(q, kk); t.append(d); }
      sb.append(el('div', 'hint', 'Borders'), t);
    }
    st.append(sb);
  }

  // motion
  motionBlocks(k, st, accent);
  if (s.gaps.length) { const g = blk('Not captured'); g.append(mdLite(s.gaps.map((x) => '- ' + x).join('\n'), 'facts')); st.append(g); }
}

// ---------------------------------------------------------------- motion replay
function scopedKeyframes(k) {
  const style = el('style'); let css = '';
  for (const [name, body] of Object.entries(k.sheet.keyframes || {})) css += body.replace('@keyframes ' + name, `@keyframes k-${name}`) + '\n';
  style.textContent = css; return style;
}
const clampPx = (v) => { const m = /^(-?[\d.]+)px$/.exec(v); return m ? Math.max(-70, Math.min(70, +m[1])) + 'px' : v; };
function fromGuess(to) {
  const f = {};
  for (const [p, v] of Object.entries(to)) {
    if (p === 'opacity') f[p] = 0; else if (p === 'translate') f[p] = '0px 16px'; else if (p === 'scale') f[p] = '0.6';
    else if (p === 'rotate') f[p] = '-45deg'; else if (p === 'transform') f[p] = 'translateY(16px)'; else if (p === 'filter') f[p] = 'blur(6px)'; else f[p] = v;
  }
  return f;
}
function framesFor(m, color) {
  if (m.kind === 'waapi') {
    const kf = m.kf;
    if (Array.isArray(kf)) return kf.length === 1 ? [fromGuess(kf[0]), kf[0]] : kf;
    const out = {}; for (const [p, v] of Object.entries(kf)) out[p] = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.replace(/-?[\d.]+px/g, clampPx) : x)) : v;
    return out;
  }
  if (m.kind === 'sampled') {
    const a = {}, b = {}; let tx = ['0px', '0px'], ty = ['0px', '0px'], has = false;
    for (const [p, f, t] of m.pairs) {
      const u = (x) => (/^-?[\d.]+$/.test(x) ? x + 'px' : x);
      if (p === 'y') { ty = [clampPx(u(f)), clampPx(u(t))]; has = true; } else if (p === 'x') { tx = [clampPx(u(f)), clampPx(u(t))]; has = true; }
      else if (p === 'opacity' || p === 'scale') { a[p] = String(f); b[p] = String(t); }
      else if (p === 'rotate') { a[p] = f; b[p] = t; }
    }
    if (has) { a.translate = `${tx[0]} ${ty[0]}`; b.translate = `${tx[1]} ${ty[1]}`; }
    return Object.keys(a).length ? [a, b] : [{ opacity: 0 }, { opacity: 1 }];
  }
  if (m.kind === 'transition') {
    const ps = (m.props || []).join(' ');
    if (/transform|translate|scale|rotate/.test(ps)) return [{ transform: 'translateY(16px) scale(0.9)', opacity: /opacity/.test(ps) ? 0 : 1 }, { transform: 'none', opacity: 1 }];
    if (/background|color|fill/.test(ps)) return [{ backgroundColor: '#9aa3ad' }, { backgroundColor: color }];
    if (/filter/.test(ps)) return [{ filter: 'blur(6px)' }, { filter: 'blur(0px)' }];
    if (/width|height|left|right|top|bottom|inset/.test(ps)) return [{ transform: 'scaleX(0.3)' }, { transform: 'scaleX(1)' }];
    return [{ opacity: 0 }, { opacity: 1 }];
  }
  return [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }];
}
function safeEase(e) { try { document.createElement('i').animate([{}, {}], { easing: e }).cancel(); return e; } catch { return 'ease'; } }
function animateChip(c, m, delay, k) {
  const known = m.kind === 'animation' && k.sheet.keyframes?.[m.name];
  const opts = { duration: Math.max(m.ms, 1), easing: safeEase(m.ease), delay, fill: 'both', iterations: m.infinite ? Infinity : 1 };
  if (known) {
    c.style.animation = 'none'; void c.offsetWidth;
    c.style.animation = `k-${m.name} ${opts.duration}ms ${opts.easing} ${delay}ms ${m.infinite ? 'infinite' : '1'} both`;
    return;
  }
  try { const a = c.animate(framesFor(m, c.style.getPropertyValue('--c')), opts); running.push(a); } catch {}
}
function specText(m) {
  const what = m.kind === 'waapi' ? 'element.animate' : m.kind === 'animation' ? `@keyframes ${m.name}` : m.kind === 'transition' ? `transition ${(m.props || []).join(', ')}` : m.kind === 'sampled' ? 'JS, sampled' : m.kind;
  return `${m.ms}ms ${m.easeName || m.ease.replace(/cubic-bezier/, 'cb')}${m.delay ? ` +${m.delay}` : ''}${m.stagger ? ` ~${m.stagger}/each` : ''}\n${what}`;
}
function motionRow(m, k, color, T) {
  const r = el('div', 'mo-row'); r.tabIndex = 0; r.title = m.raw;
  const lab = el('div', 'lab'); lab.append(el('b', '', m.label), document.createTextNode(m.n > 1 ? `${m.n} elements` : ''));
  if (m.when) lab.append(el('div', 'when', m.when.replace('scrollY', 'scroll ')));
  const mid = el('div');
  const lane = el('div', 'lane');
  const n = Math.min(m.n, m.stagger ? 6 : 3);
  const chips = Array.from({ length: Math.max(n, 1) }, () => { const c = el('i', 'chipx'); c.style.setProperty('--c', color); lane.append(c); return c; });
  mid.append(lane);
  if (T) {
    const tl = el('div', 'timeline'), bar = el('i', 'tl-bar');
    const end = Math.min(T, m.delay + m.ms + m.stagger * (n - 1));
    bar.style.left = (m.delay / T * 100) + '%'; bar.style.width = Math.max((end - m.delay) / T * 100, 0.6) + '%';
    tl.append(bar); mid.append(tl);
  }
  const sp = el('div', 'spec', specText(m)); sp.style.whiteSpace = 'pre-line';
  if (m.approx) sp.append(el('div', 'approx', m.kind === 'transition' ? 'generic end state' : 'approximate'));
  r.append(lab, mid, sp);
  const play = (withDelay = true) => chips.forEach((c, i) => animateChip(c, m, (withDelay ? m.delay : 0) + i * m.stagger, k));
  r.addEventListener('click', () => play(false));
  r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(false); } });
  r.play = play;
  return r;
}
function motionBlocks(k, st, color) {
  const s = k.sheet;
  const g = { load: [], scroll: [], loop: [] };
  s.motion.forEach((m) => g[m.group].push(m));
  if (!s.motion.length && !s.declared.length) {
    const b = blk('Motion'); b.append(el('p', 'facts', 'Nothing animated during load or scroll. A static page, by the look of the measurements.')); st.append(b); return;
  }
  st.append(scopedKeyframes(k));
  if (g.load.length) {
    const rows = g.load.slice().sort((a, b) => a.delay - b.delay);
    const T = Math.max(1000, Math.min(4000, Math.max(...rows.map((m) => m.delay + m.ms + m.stagger * (Math.min(m.n, 6) - 1)))));
    const playAll = el('button', 'btn', '▶ Play load'); playAll.type = 'button';
    const b = blk(`On load · ${rows.length}`, playAll);
    b.append(el('div', 'hint', 'The page’s opening choreography, on one clock. Click a row to replay just that one.'));
    const ruler = el('div', 'ruler'), scale = el('div', 'scale');
    for (let t = 0; t <= T; t += T > 2000 ? 500 : 250) { const s2 = el('span', '', t ? `${t}` : '0ms'); s2.style.left = (t / T * 100) + '%'; scale.append(s2); }
    const head = el('i'); scale.append(head);
    ruler.append(el('div'), scale, el('div'));
    const list = el('div', 'tl-wrap'); list.append(ruler);
    const rs = rows.map((m) => motionRow(m, k, color, T)); rs.forEach((r, i) => { if (i >= 12) r.hidden = true; list.append(r); });
    b.append(list);
    if (rs.length > 12) { const more = el('button', 'btn more', `Show all ${rs.length}`); more.type = 'button'; more.addEventListener('click', () => { rs.forEach((r) => (r.hidden = false)); more.remove(); }); b.append(more); }
    const go = () => { stopAll(); rs.forEach((r) => r.play(true)); try { running.push(head.animate([{ left: '0%', opacity: 1 }, { left: '100%', opacity: 1 }], { duration: T, easing: 'linear', fill: 'forwards' })); } catch {} };
    playAll.addEventListener('click', go);
    st.append(b);
    if (!REDUCED) setTimeout(go, 250);
  }
  if (g.scroll.length) {
    const rows = g.scroll.slice().sort((a, b) => a.at - b.at);
    const b = blk(`On scroll · ${rows.length}`);
    b.append(el('div', 'hint', 'Triggered as the page scrolls, in page order. Click a row to play it.'));
    const list = el('div', 'mo'); b.append(list);
    const shown = 10;
    rows.forEach((m, i) => { const r = motionRow(m, k, color); if (i >= shown) r.hidden = true; list.append(r); });
    if (rows.length > shown) { const more = el('button', 'btn more', `Show all ${rows.length}`); more.type = 'button'; more.addEventListener('click', () => { list.querySelectorAll('.mo-row[hidden]').forEach((r) => (r.hidden = false)); more.remove(); }); b.append(more); }
    st.append(b);
  }
  if (g.loop.length) {
    const b = blk(`Looping · ${g.loop.length}`);
    const list = el('div', 'mo'); b.append(list);
    g.loop.forEach((m) => { const r = motionRow(m, k, color); list.append(r); if (!REDUCED) r.play(false); });
    st.append(b);
  }
  if (s.declared.length) {
    const b = blk(`On hover and focus · ${s.declared.length}`);
    b.append(el('div', 'hint', 'Declared transitions that were never triggered during capture. Hover a row to feel the timing; the end state is generic.'));
    const list = el('div', 'mo');
    for (const d of s.declared) {
      const r = el('div', 'mo-row'), lab = el('div', 'lab'); lab.append(el('b', '', d.props), document.createTextNode(`${d.n} elements${d.eg ? ' · ' + d.eg : ''}`));
      const lane = el('div', 'lane'), c = el('i', 'chipx');
      c.style.setProperty('--c', '#9aa3ad'); c.style.transition = `transform ${d.ms}ms ${safeEase(d.ease)}, background-color ${d.ms}ms ${safeEase(d.ease)}`;
      lane.append(c);
      const sp = el('div', 'spec', `${d.ms}ms ${d.easeName || d.ease}`);
      r.append(lab, lane, sp);
      r.addEventListener('mouseenter', () => { c.style.transform = 'translateX(48px) scale(1.15)'; c.style.background = color; });
      r.addEventListener('mouseleave', () => { c.style.transform = ''; c.style.background = ''; });
      list.append(r);
    }
    b.append(list); st.append(b);
  }
}

// ---------------------------------------------------------------- clip: screens + record
function clipScreens(k, st) {
  if (k.frames.length) {
    const b = blk(`Filmstrip · ${k.frames.length} frames`, el('span', 'hint', 'the automated scroll, top to bottom'));
    const view = el('div', 'frame-view'), big = img(k.frames[0], 'Frame 1');
    const scrub = el('div', 'scrub'), range = el('input'), lab = el('span', 'mono', `01 / ${String(k.frames.length).padStart(2, '0')}`);
    range.type = 'range'; range.min = 0; range.max = k.frames.length - 1; range.value = 0; range.id = 'frame-scrub'; range.setAttribute('aria-label', 'Frame');
    const sheet = el('div', 'contact');
    const set = (i) => {
      big.src = k.frames[i]; big.alt = `Frame ${i + 1}`; range.value = i; lab.textContent = `${String(i + 1).padStart(2, '0')} / ${String(k.frames.length).padStart(2, '0')}`;
      sheet.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-current', String(j === i)));
    };
    range.addEventListener('input', () => set(+range.value));
    k.frames.forEach((f, i) => { const bt = el('button'); bt.type = 'button'; bt.append(img(f, `Frame ${i + 1}`), el('span', 'mono', String(i + 1).padStart(2, '0'))); bt.addEventListener('click', () => set(i)); sheet.append(bt); });
    scrub.append(range, lab); view.append(big, scrub); b.append(view, sheet); st.append(b);
    set(0);
  }
  if (k.img) { const b = blk('As you saw it', el('span', 'hint', 'seen.jpg, the viewport when you clipped')); b.append(img(k.img, 'Seen', 'shotfull')); b.lastChild.style.cssText = 'width:100%;border-radius:2px;display:block'; st.append(b); }
  if (k.full) { const b = blk('Full page', el('span', 'hint', 'full.jpg at 1440px wide; scroll inside')); const f = el('div', 'fullpage'); f.append(img(k.full, 'Full page')); b.append(f); st.append(b); }
  if (!k.frames.length && !k.img && !k.full) st.append(el('p', 'note empty', 'No screens for this clip.'));
}
function clipRecord(k, st) {
  const b = blk('clip.md', el('span', 'hint', 'the record your agent reads'));
  b.append(el('pre', 'record', k.record)); st.append(b);
}

// ---------------------------------------------------------------- patterns
function patSpecimen(p, st) {
  if (!p.specimen) {
    st.append(el('p', 'note empty', 'No specimen yet. Ask your agent to add a ## Specimen block to this pattern (the artspo skill describes the format).'));
    return;
  }
  const replay = el('button', 'btn', '↻ Replay'); replay.type = 'button';
  const b = blk('Live specimen', replay);
  const frame = el('div', 'spec-frame'), host = specimenHost(p.specimen);
  frame.append(host); replay.addEventListener('click', () => host.replay());
  b.append(frame, el('div', 'hint', 'A generic rebuild of the move, from the recipe: no site’s code or content.'));
  st.append(b);
  const sp = el('div', 'split');
  if (p.use) { const u = blk('Use when'); u.append(mdLite(p.use, 'facts')); sp.append(u); }
  if (p.avoid) { const a = blk('Avoid when'); a.append(mdLite(p.avoid, 'facts')); sp.append(a); }
  if (sp.children.length) st.append(sp);
  if (p.type === 'language') {
    const ts = [...near(p.id)].filter(([, l]) => l === 'Techniques').map(([o]) => items.get(o)).filter((t) => t.specimen);
    if (ts.length) {
      const g = blk(`Its techniques · ${ts.length}`), grid = el('div', 'grid tight');
      ts.forEach((t) => { const c = el('article', 'card tech'); c.tabIndex = 0; c.setAttribute('role', 'button'); c.addEventListener('click', () => openViewer(t.id)); const bd = el('div', 'body'); bd.append(mini(t.specimen), el('h3', '', t.title)); c.append(bd); grid.append(c); });
      g.append(grid); st.append(g);
    }
  }
}
function patEvidence(p, st) {
  if (p.from_book && !p.proof.length) { st.append(el('p', 'note empty', `Imported from ${p.from_book}. Its evidence lives in that book.`)); return; }
  const b = blk(`Evidence · ${p.proof.length}`, el('span', 'hint', 'verbatim from clip.md, or observed in a screenshot'));
  const list = el('div', 'proof');
  for (const e of p.proof) {
    const c = clip(e.clip);
    const row = el('button', 'p'); row.type = 'button';
    if (c?.img) row.append(img(c.img, c.title)); else row.append(el('span'));
    const t = el('div'); t.append(el('b', '', `${e.name} · ${e.source}`), el('code', '', e.quote));
    row.append(t);
    if (c) row.addEventListener('click', () => openViewer(c.id, e.source === 'clip.md' ? 'elements' : 'screens'));
    list.append(row);
  }
  b.append(list); st.append(b);
}
function patRecipe(p, st) {
  if (!p.recipe.length) { st.append(el('p', 'note empty', 'No recipe in this pattern file.')); return; }
  p.recipe.forEach((r, i) => {
    const cp = el('button', 'btn', 'Copy'); cp.type = 'button'; cp.addEventListener('click', () => copy(r, cp));
    const b = blk(i === 0 ? (p.type === 'language' ? 'Starter tokens' : 'Recipe') : 'Starter tokens', cp);
    b.append(el('pre', 'code', r)); st.append(b);
  });
}

// ---------------------------------------------------------------- works
function workPreview(w, st) {
  if (w.html) {
    const a = el('a', 'btn', 'Open in a tab'); a.href = w.html; a.target = '_blank';
    const b = blk(w.html.split('/').pop(), a); const f = el('iframe', 'work-frame'); f.src = w.html; f.title = w.title; f.loading = 'lazy'; b.append(f); st.append(b);
  } else if (w.img) { const b = blk('Preview'); const i = img(w.img, w.title); i.style.cssText = 'width:100%;border-radius:2px;display:block'; b.append(i); st.append(b); }
  else st.append(el('p', 'note empty', 'No preview. Add preview.jpg to the work folder.'));
  const sp = el('div', 'split');
  if (w.made_from) { const m = blk('Made from'); m.append(mdLite(w.made_from, 'facts')); sp.append(m); }
  if (w.left_out) { const l = blk('Left out'); l.append(mdLite(w.left_out, 'facts')); sp.append(l); }
  if (sp.children.length) st.append(sp);
}
function workFiles(w, st) {
  const names = Object.keys(w.texts || {});
  const b = blk(`Files · ${w.files.length}`); b.append(el('div', 'facts', w.files.join(' · '))); st.append(b);
  for (const n of names) {
    const cp = el('button', 'btn', 'Copy'); cp.type = 'button'; cp.addEventListener('click', () => copy(w.texts[n], cp));
    const f = blk(n, cp); f.append(el('pre', 'code', w.texts[n])); st.append(f);
  }
}

applyFilters();
const h = decodeURIComponent(location.hash.slice(1));
if (h && items.has(h)) openViewer(h);
})();
