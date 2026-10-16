// Turns the raw inspection result into clip.md — the artifact the agent reads.
// Pure functions, no chrome.* APIs, so this can be unit-tested in Node.

// ---------------- small helpers ----------------
const yamlStr = (s) => JSON.stringify(String(s ?? ''));
const yamlList = (arr) => `[${(arr || []).map((t) => yamlStr(t)).join(', ')}]`;

export function parseColor(c) {
  if (!c) return null;
  let m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  m = String(c).match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}
export function hex(c) {
  const p = typeof c === 'string' ? parseColor(c) : c;
  if (!p) return String(c);
  const h = '#' + [p.r, p.g, p.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  return p.a < 1 ? `${h} @${Math.round(p.a * 100)}%` : h;
}
const dist = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

// Merge near-identical colors; input [{color, w}] -> [{hex, w, share}]
export function mergeColors(items, threshold = 14) {
  const out = [];
  for (const it of items) {
    const p = parseColor(it.color);
    if (!p || p.a === 0) continue;
    const hit = out.find((o) => dist(o.p, p) < threshold && Math.abs(o.p.a - p.a) < 0.2);
    if (hit) { hit.w += it.w; if (it.ex) hit.ex.push(...it.ex); }
    else out.push({ p, w: it.w, ex: [...(it.ex || [])] });
  }
  const total = out.reduce((s, o) => s + o.w, 0) || 1;
  return out.sort((a, b) => b.w - a.w).map((o) => ({ hex: hex(o.p), w: o.w, share: o.w / total, ex: o.ex.slice(0, 3), p: o.p }));
}

export function ms(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim();
  if (s.endsWith('ms')) return Math.round(parseFloat(s));
  if (s.endsWith('s')) return Math.round(parseFloat(s) * 1000);
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}
const fmtMs = (v) => (v == null ? '?' : `${v}ms`);

const NAMED_EASINGS = {
  '0.25,0.1,0.25,1': 'ease', '0.42,0,1,1': 'ease-in', '0,0,0.58,1': 'ease-out', '0.42,0,0.58,1': 'ease-in-out',
  '0.16,1,0.3,1': 'expo-out', '0.22,1,0.36,1': 'quint-out', '0.25,1,0.5,1': 'quart-out', '0.33,1,0.68,1': 'cubic-out',
  '0.61,1,0.88,1': 'sine-out', '0.65,0,0.35,1': 'cubic-in-out', '0.76,0,0.24,1': 'quart-in-out',
  '0.87,0,0.13,1': 'expo-in-out', '0.83,0,0.17,1': 'quint-in-out', '0.34,1.56,0.64,1': 'back-out',
  '0.4,0,0.2,1': 'material standard', '0.2,0,0,1': 'material emphasized', '0.19,1,0.22,1': 'expo-out (variant)',
};
export function easing(e) {
  if (!e) return undefined;
  const m = String(e).match(/cubic-bezier\(([^)]+)\)/);
  if (!m) return String(e);
  const key = m[1].split(',').map((x) => String(parseFloat(x))).join(',');
  return NAMED_EASINGS[key] ? `${e} (${NAMED_EASINGS[key]})` : e;
}

// ---------------- inline-style motion parsing ----------------
function styleMap(s) {
  const m = {};
  for (const part of String(s || '').split(/;(?![^(]*\))/)) {
    const i = part.indexOf(':');
    if (i > 0) m[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return m;
}
const num = (s) => {
  const m = String(s ?? '').match(/(-?[\d.]+)(px|%|deg|rad|turn|em|rem|vh|vw)?/);
  return m ? { v: parseFloat(m[1]), u: m[2] || '' } : null;
};
export function parseTransform(t) {
  const r = {};
  if (!t || t === 'none') return r;
  let m;
  if ((m = t.match(/matrix3d\(([^)]+)\)/))) {
    const a = m[1].split(',').map(parseFloat);
    r.x = { v: a[12], u: 'px' }; r.y = { v: a[13], u: 'px' };
    r.scale = { v: +Math.sqrt(a[0] ** 2 + a[1] ** 2).toFixed(3), u: '' };
  } else if ((m = t.match(/matrix\(([^)]+)\)/))) {
    const a = m[1].split(',').map(parseFloat);
    r.x = { v: a[4], u: 'px' }; r.y = { v: a[5], u: 'px' };
    r.scale = { v: +Math.sqrt(a[0] ** 2 + a[1] ** 2).toFixed(3), u: '' };
    const rot = Math.round((Math.atan2(a[1], a[0]) * 180) / Math.PI);
    if (rot) r.rotate = { v: rot, u: 'deg' };
  }
  for (const fm of t.matchAll(/(translate3d|translate|translateX|translateY|scale3d|scale|scaleX|scaleY|rotate|rotateZ|skewX|skewY)\(([^)]*)\)/g)) {
    const [fn, args] = [fm[1], fm[2].split(',').map((s) => s.trim())];
    if (fn === 'translate' || fn === 'translate3d') { r.x = num(args[0]); if (args[1]) r.y = num(args[1]); }
    else if (fn === 'translateX') r.x = num(args[0]);
    else if (fn === 'translateY') r.y = num(args[0]);
    else if (fn === 'scale' || fn === 'scale3d') r.scale = num(args[0]);
    else if (fn === 'scaleX') r.scaleX = num(args[0]);
    else if (fn === 'scaleY') r.scaleY = num(args[0]);
    else if (fn === 'rotate' || fn === 'rotateZ') r.rotate = num(args[0]);
    else r[fn] = num(args[0]);
  }
  return r;
}
const fmtNum = (n) => (n == null ? '?' : `${['px', '%', 'deg'].includes(n.u) ? Math.round(n.v) : +n.v.toFixed(2)}${n.u}`);

// Describe what changed between the first and last inline style of a segment.
export function describeDelta(fromStyle, toStyle, firstStyle) {
  // properties missing from the pre-animation style start at their first-frame value
  const a = { ...styleMap(firstStyle), ...styleMap(fromStyle) }, b = styleMap(toStyle);
  const parts = [];
  const ta = parseTransform(a.transform), tb = parseTransform(b.transform);
  // individual transform properties (translate: / scale: / rotate:)
  for (const k of ['translate', 'scale', 'rotate']) {
    if (a[k] !== b[k]) {
      if (k === 'translate') {
        const pa = (a[k] || '0px 0px').split(/\s+/), pb = (b[k] || '0px 0px').split(/\s+/);
        ta.x = num(pa[0]); tb.x = num(pb[0]); ta.y = num(pa[1] || '0px'); tb.y = num(pb[1] || '0px');
      } else { ta[k] = num(a[k] || (k === 'scale' ? '1' : '0deg')); tb[k] = num(b[k] || (k === 'scale' ? '1' : '0deg')); }
    }
  }
  const keys = new Set([...Object.keys(ta), ...Object.keys(tb)]);
  for (const k of keys) {
    const def = k.startsWith('scale') ? { v: 1, u: '' } : { v: 0, u: k === 'rotate' ? 'deg' : 'px' };
    const x = ta[k] || def, y = tb[k] || def;
    if (Math.abs(x.v - y.v) > 0.5 || (k.startsWith('scale') && Math.abs(x.v - y.v) > 0.01)) parts.push(`${k} ${fmtNum(x)}→${fmtNum(y)}`);
  }
  const op = (s) => (s.opacity === undefined ? 1 : +parseFloat(s.opacity).toFixed(2));
  if (Math.abs(op(a) - op(b)) >= 0.05) parts.push(`opacity ${op(a)}→${op(b)}`);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (['transform', 'opacity', 'translate', 'scale', 'rotate', 'will-change', 'visibility', 'transition'].includes(k)) continue;
    if (a[k] !== b[k] && parts.length < 5) {
      const v = (s) => (s === undefined ? '∅' : s.length > 40 ? s.slice(0, 37) + '…' : s);
      parts.push(`${k} ${v(a[k])}→${v(b[k])}`);
    }
  }
  return parts.join(', ');
}

const median = (arr) => {
  if (!arr.length) return undefined;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const staggerOf = (starts) => {
  const s = [...starts].sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > 8) diffs.push(s[i] - s[i - 1]);
  const m = median(diffs);
  return m && m < 400 ? Math.round(m / 10) * 10 : undefined;
};
// element signature for grouping: drop ids and per-instance classes with digits
const sig = (el) => String(el || '').replace(/#[^.]*/, '').replace(/\.[^.]*\d{2,}[^.]*/g, '');

// ---------------- motion summarizers ----------------
function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return [...m.values()];
}
const exampleEls = (g) => {
  const seen = [];
  for (const it of g) {
    const label = it.text ? `${sig(it.el)} "${it.text.slice(0, 24)}"` : sig(it.el);
    if (!seen.includes(label)) seen.push(label);
    if (seen.length >= 2) break;
  }
  return seen.join(', ');
};
const scrollNote = (g) => {
  const ys = g.map((x) => x.scrollY).filter((y) => y != null);
  if (!ys.length) return '';
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return lo === hi ? ` at scrollY≈${lo}` : ` between scrollY ${lo}–${hi}`;
};

export function summarizeMotion(m, phase) {
  const lines = [];
  // CSS animations / transitions that actually fired
  // infinite animations are reported once, under Looping
  const css = (m.css || []).filter((c) => c.phase === phase && c.iterations !== 'infinite');
  // transitions on several properties of the same elements with the same timing read as one motion
  for (const g of groupBy(css, (c) => [c.kind, c.kind === 'animation' ? c.name : '', c.duration, c.easing, sig(c.el)].join('|'))) {
    const c = g[0];
    const els = new Set(g.map((x) => x.el + x.text));
    const delays = [...new Set(g.map((x) => ms(x.delay)).filter((d) => d != null))];
    const stg = delays.length > 1 ? staggerOf(delays) : staggerOf([...new Set(g.map((x) => x.t))]);
    const props = [...new Set(g.map((x) => x.property))];
    const what = c.kind === 'animation' ? `CSS animation \`${c.name}\`` : `CSS transition on \`${props.join('`, `')}\``;
    let line = `${els.size > 1 ? els.size + '× ' : ''}${exampleEls(g)}: ${what}, ${fmtMs(ms(c.duration))}, ${easing(c.easing)}`;
    if (stg) line += `, ~${stg}ms stagger`;
    else if (ms(c.delay)) line += `, ${ms(c.delay)}ms delay`;
    if (c.kind === 'animation' && c.iterations && c.iterations !== '1') line += `, iterations ${c.iterations}`;
    if (phase === 'scroll') line += scrollNote(g);
    lines.push(line);
  }
  // Web Animations API calls
  const wa = (m.waapi || []).filter((c) => c.phase === phase);
  for (const g of groupBy(wa, (c) => [c.keyframes, c.duration, c.easing, sig(c.el)].join('|'))) {
    const c = g[0];
    const stg = g.length > 1 ? staggerOf(g.map((x) => x.t)) : undefined;
    let line = `${g.length > 1 ? g.length + '× ' : ''}${exampleEls(g)}: element.animate ${c.keyframes}, ${fmtMs(ms(c.duration))}, ${easing(c.easing) || 'linear'}`;
    if (c.delay) line += `, ${c.delay}ms delay`;
    if (stg) line += `, ~${stg}ms stagger`;
    if (phase === 'scroll') line += scrollNote(g);
    lines.push(line);
  }
  // GSAP calls (exact values, when reachable)
  const gs = (m.gsap || []).filter((c) => c.phase === phase);
  for (const g of groupBy(gs, (c) => [c.method, sig(c.targets), c.props.join(','), c.duration, c.ease].join('|')).slice(0, 20)) {
    const c = g[0];
    let line = `${g.length > 1 ? g.length + '× ' : ''}GSAP \`${c.method}\` ${c.targets}: ${c.props.join(', ')}`;
    if (c.from) line += ` (from ${c.from.join(', ')})`;
    line += `, duration ${c.duration ?? 'default 0.5'}s, ease ${c.ease || 'power1.out (default)'}`;
    if (c.delay) line += `, delay ${c.delay}s`;
    if (c.stagger) line += `, stagger ${c.stagger}`;
    if (c.repeat) line += `, repeat ${c.repeat}${c.yoyo ? ' yoyo' : ''}`;
    if (c.scrollTrigger) {
      const s = c.scrollTrigger;
      line += ` — ScrollTrigger on ${s.trigger}${s.start ? `, start "${s.start}"` : ''}${s.end ? `, end "${s.end}"` : ''}${s.scrub ? `, scrub ${s.scrub}` : ''}${s.pin ? ', pinned' : ''}`;
    }
    lines.push(line);
  }
  // Inline-style motion (JS-driven, sampled)
  const segs = [];
  for (const rec of m.inline || []) {
    for (const s of rec.segs) {
      if (s.phase !== phase || s.n < 3) continue;
      const delta = describeDelta(s.from, s.to, s.first);
      if (!delta) continue;
      segs.push({ el: rec.el, text: rec.text, t: s.t0, dur: s.t1 - s.t0, n: s.n, delta, scrollY: s.scrollY });
    }
  }
  const deltaShape = (d) => d.replace(/-?[\d.]+(px|%|deg)?/g, '#');
  for (const g of groupBy(segs, (s) => [sig(s.el), deltaShape(s.delta), Math.round(s.dur / 150)].join('|')).slice(0, 16)) {
    const c = g[0];
    const durs = g.map((x) => x.dur);
    const stg = g.length > 1 ? staggerOf(g.map((x) => x.t)) : undefined;
    let line = `${g.length > 1 ? g.length + '× ' : ''}${exampleEls(g)}: ${c.delta}, ~${Math.round(median(durs) / 10) * 10}ms (JS-driven, sampled from inline styles)`;
    if (stg) line += `, ~${stg}ms stagger`;
    if (phase === 'scroll') line += scrollNote(g);
    lines.push(line);
  }
  return lines;
}

// ---------------- the document ----------------
export function buildStub(job) {
  return [
    '---',
    `url: ${job.url}`,
    `title: ${yamlStr(job.title)}`,
    `collection: ${job.collection}`,
    `tags: ${yamlList(job.tags)}`,
    `clipped: ${job.clippedAt}`,
    'status: queued',
    'depth: surface',
    '---',
    '',
    '## Note',
    job.note ? job.note : '_(no note)_',
    '',
    '_Inspection is queued — it runs the next time you step away from the computer, or when you press "Process now" in the Artspo popup. This file will be rewritten with tokens and motion._',
    '',
    '## Files',
    job.seen ? '- seen.jpg — the viewport exactly as it looked when you clipped it' : '- (added from a list of links, so there is no seen.jpg; the first filmstrip frame shows the top of the page)',
    '',
  ].join('\n');
}

// <collection>/collection.md: the collection's brief and the links added to it, for people and agents
export function buildCollectionMd(name, meta = {}) {
  const links = meta.links || [];
  return [
    '---',
    `collection: ${name}`,
    `title: ${yamlStr(meta.title || name)}`,
    `updated: ${meta.updated || ''}`,
    '---',
    `# ${meta.title || name}`,
    '',
    '## Brief',
    meta.brief && meta.brief.trim() ? meta.brief.trim() : '_(no brief yet: what is this collection for? Edit it in Artspo setup.)_',
    '',
    '## Links',
    links.length ? links.map((l) => `- ${l.url}${l.why ? ` — ${l.why}` : ''} (added ${l.added})`).join('\n') : '_(none added as a list yet; clips made with the popup are the folders next to this file)_',
    '',
    '---',
    '_Written by the Artspo extension. Each clip in this collection is a folder next to this file. Works made for it say `collection: ' + name + '` in their work.md._',
    '',
  ].join('\n');
}

export function buildClipMd(job, r, diag, files) {
  const L = [];
  const push = (...xs) => L.push(...xs);
  const status = diag.partial ? 'partial' : 'complete';

  push('---',
    `url: ${job.url}`,
    `title: ${yamlStr(r.meta?.title || job.title)}`,
    `collection: ${job.collection}`,
    `tags: ${yamlList(job.tags)}`,
    `clipped: ${job.clippedAt}`,
    `inspected: ${diag.inspectedAt}`,
    `status: ${status}`,
    'depth: surface',
    `libraries: ${yamlList((r.libs || []).map((l) => l.replace(/ \(.*\)$/, '')))}`,
    '---', '');

  push('## Note', job.note ? job.note : '_(no note)_', '');
  if (r.meta?.description) push(`> ${r.meta.description}`, '');

  // Palette
  const bg = Object.entries(r.bgSamples || {});
  const media = bg.filter(([k]) => ['image', 'img', 'video', 'canvas'].includes(k)).reduce((s, [, v]) => s + v, 0);
  const bgTotal = bg.reduce((s, [, v]) => s + v, 0) || 1;
  const bgColors = mergeColors(bg.filter(([k]) => parseColor(k)).map(([color, w]) => ({ color, w })));
  const txt = mergeColors((r.text?.colors || []).map((c) => ({ color: c.value, w: c.w })));
  push('## Palette');
  push('**Surfaces** (share of on-screen area across the whole page)');
  for (const c of bgColors.slice(0, 6)) {
    const share = (c.w / bgTotal) * 100;
    if (share >= 0.5) push(`- ${c.hex} — ${share.toFixed(share < 10 ? 1 : 0)}%`);
  }
  if (media / bgTotal > 0.03) push(`- imagery / video / canvas — ${Math.round((media / bgTotal) * 100)}%`);
  push('', '**Text** (weighted by amount of text)');
  for (const c of txt.slice(0, 4)) push(`- ${c.hex} — ${Math.round(c.share * 100)}%`);
  const known = [...bgColors.slice(0, 3), ...txt.slice(0, 2)];
  const accents = mergeColors((r.components?.buttons || []).flatMap((b) => [{ color: b.kind === 'filled' ? b.background : b.border?.split(' ').slice(1).join(' '), w: b.n, ex: b.labels }]))
    .filter((a) => !known.some((k) => dist(k.p, a.p) < 30));
  if (accents.length) {
    push('', '**Accent candidates** (from buttons and CTAs)');
    for (const a of accents.slice(0, 3)) push(`- ${a.hex}${a.ex.length ? ` — e.g. "${a.ex[0]}"` : ''}`);
  }
  if (r.meta?.themeColor) push('', `theme-color meta: ${r.meta.themeColor}`);
  push('');

  // Typography
  push('## Typography');
  const fams = r.type?.families || [];
  const famTotal = fams.reduce((s, f) => s + f.w, 0) || 1;
  const h = (r.type?.headings || [])[0];
  if (h) {
    const em = (v) => (/px$/.test(v) && parseFloat(h.size) ? ` (${+(parseFloat(v) / parseFloat(h.size)).toFixed(3)}em)` : '');
    const lh = /px$/.test(h.lineHeight) ? ` (${+(parseFloat(h.lineHeight) / parseFloat(h.size)).toFixed(2)})` : '';
    push(`- Display: "${h.family}" ${h.size}/${h.weight}, letter-spacing ${h.letterSpacing}${em(h.letterSpacing)}, line-height ${h.lineHeight}${lh}${h.transform ? ', ' + h.transform : ''} — "${h.text}"`);
  }
  if (r.type?.body) push(`- Body: "${r.type.body.family}" ${r.type.body.size}, line-height ${r.type.body.lineHeight}, measure ~${r.type.body.maxWidth}px`);
  if (fams.length) push(`- Families by text share: ${fams.map((f) => `${f.value} ${Math.round((f.w / famTotal) * 100)}%`).join(', ')}`);
  const scale = [...new Map((r.type?.sizes || []).map((s) => {
    const [size, weight, fam] = s.value.split('|');
    return [size, { size: +size, weight, fam, ex: s.ex[0] }];
  })).values()].sort((a, b) => b.size - a.size);
  if (scale.length) push(`- Type scale (px): ${scale.map((s) => s.size).join(' / ')}`);
  for (const s of scale.slice(0, 4)) push(`  - ${s.size}px ${s.weight} ${s.fam}${s.ex ? ` — "${s.ex}"` : ''}`);
  if (r.type?.fontFaces?.length) push(`- Loaded webfonts: ${r.type.fontFaces.join(', ')}`);
  push('');

  // Shape
  push('## Shape & spacing');
  const rad = (r.shape?.radii || []).map((x) => `${x.value} (${x.n}× e.g. ${sig(x.ex[0])})`);
  push(`- Radii: ${rad.length ? rad.slice(0, 4).join('; ') : 'none — square corners'}`);
  const sh = r.shape?.shadows || [];
  push(`- Shadows: ${sh.length ? sh.slice(0, 3).map((x) => `\`${x.value}\` (${x.n}×)`).join('; ') : 'none — depth comes from color/surface'}`);
  const bd = r.shape?.borders || [];
  if (bd.length) push(`- Borders: ${bd.slice(0, 3).map((x) => `${x.value.replace(/rgba?\([^)]+\)/, (c) => hex(c))} (${x.n}×)`).join('; ')}`);
  const pxVals = [...(r.spacing?.sectionPadding || []), ...(r.spacing?.gaps || [])].flatMap((x) => Array(x.n).fill(parseFloat(x.value)));
  if (pxVals.length) {
    const by8 = pxVals.filter((v) => v % 8 === 0).length / pxVals.length;
    const by4 = pxVals.filter((v) => v % 4 === 0).length / pxVals.length;
    const grid = by8 >= 0.7 ? '8px grid' : by4 >= 0.7 ? '4px grid' : 'no consistent grid';
    push(`- Spacing: ${grid}; section padding ${(r.spacing.sectionPadding || []).slice(0, 4).map((x) => x.value).join(', ') || 'n/a'}; gaps ${(r.spacing.gaps || []).slice(0, 4).map((x) => x.value).join(', ') || 'n/a'}`);
  }
  push('');

  // Components
  const btns = r.components?.buttons || [];
  if (btns.length) {
    push('## Buttons');
    for (const b of btns.slice(0, 3)) {
      push(`- ${b.kind}${b.kind === 'filled' ? ` ${hex(b.background)}` : ''}, text ${hex(b.color)}, radius ${b.radius}, padding ${b.padding}, ${b.fontSize}/${b.fontWeight}${b.textTransform ? ', ' + b.textTransform : ''}${b.border ? `, border ${b.border.replace(/rgba?\([^)]+\)/, (c) => hex(c))}` : ''}, ~${b.height}px tall — ${b.labels.map((l) => `"${l}"`).join(', ')}`);
    }
    push('');
  }

  // Motion
  push('## Motion');
  push(`**Libraries:** ${(r.libs || []).length ? r.libs.join(', ') : 'none detected (plain CSS/JS)'}`, '');
  const load = summarizeMotion(r.motion || {}, 'load');
  const scroll = summarizeMotion(r.motion || {}, 'scroll');
  push('**On load**');
  push(...(load.length ? load.map((l) => '- ' + l) : ['- nothing animated during load']), '');
  push('**On scroll**');
  push(...(scroll.length ? scroll.map((l) => '- ' + l) : ['- nothing animated while scrolling']), '');
  const loops = (r.motion?.running || []).filter((a) => a.iterations === Infinity || a.iterations === null || a.iterations > 1);
  if (loops.length) {
    push('**Looping**');
    for (const g of groupBy(loops, (a) => [a.name, a.duration, a.easing].join('|')).slice(0, 6)) {
      const a = g[0];
      push(`- ${g.length > 1 ? g.length + '× ' : ''}${sig(a.el)}: \`${a.name || a.type}\`, ${fmtMs(ms(a.duration))}, ${easing(a.easing)}, infinite`);
    }
    push('');
  }
  if (r.motion?.scrollTriggers?.length) {
    push('**ScrollTriggers (live GSAP)**');
    for (const s of r.motion.scrollTriggers.slice(0, 10)) {
      push(`- ${s.trigger}: start ${s.startSpec || s.start}, end ${s.endSpec || s.end}${s.scrub ? `, scrub ${s.scrub}` : ''}${s.pin ? ', pinned' : ''}${s.animation ? `, ${s.animation.duration}s ${s.animation.ease || ''}` : ''}`);
    }
    push('');
  }
  const dt = r.motion?.declaredTransitions || [];
  if (dt.length) {
    push('**Declared transitions** (state changes — hover, focus, open; not triggered during capture)');
    const grouped = groupBy(dt.map((x) => { const [p, d, e] = x.value.split('|'); return { p, d: ms(d), e, n: x.n, ex: x.ex }; }), (x) => `${x.d}|${x.e}`);
    for (const g of grouped.slice(0, 6)) {
      const props = [...new Set(g.map((x) => x.p))];
      const n = g.reduce((s, x) => s + x.n, 0);
      const ex = [...new Set(g.flatMap((x) => x.ex.map(sig)))].slice(0, 3);
      push(`- ${props.slice(0, 5).join(', ')} — ${fmtMs(g[0].d)} ${easing(g[0].e)} — ${n} elements (${ex.join(', ')})`);
    }
    push('');
  }
  const kf = r.motion?.keyframes || {};
  const used = (r.motion?.usedKeyframes || []).filter((n) => kf[n]);
  if (used.length) {
    push('**Keyframes used**');
    for (const n of used.slice(0, 8)) push('```css', kf[n], '```');
    push('');
  }

  // Gaps
  const gaps = [];
  gaps.push('Click-triggered interactions (menus, modals, tabs, accordions) — capture never clicks');
  if (dt.length) gaps.push('Hover states were not forced — see Declared transitions for their timing; the visual end state is unknown');
  const sig2 = r.signals || {};
  const webgl = (r.libs || []).some((l) => /WebGL|Three|Spline/.test(l));
  if (webgl) gaps.push('WebGL scene internals (shaders, 3D motion) — canvas detected, contents opaque');
  if (sig2.autoplayVideo) gaps.push(`${sig2.autoplayVideo} autoplay video(s) — motion is baked into video, not code`);
  if ((r.libs || []).some((l) => /Lottie|Rive/.test(l))) gaps.push('Lottie/Rive animation internals — the animation files were not parsed');
  if ((r.libs || []).some((l) => /GSAP/.test(l)) && !(r.motion?.gsap || []).length) gaps.push('GSAP is bundled privately — exact tween values were not reachable; JS-driven motion above is sampled from inline styles (approximate durations, no easing). Good candidate for a REA deep dive.');
  if (sig2.cursorFollow) gaps.push('Cursor-follow effects (cursor element detected) — capture does not move the mouse');
  if (sig2.iframes) gaps.push(`${sig2.iframes} iframe(s) not inspected`);
  const sc = diag.scroll;
  if (sc && sc.stalledAt !== undefined) gaps.push(`Scrolling stopped at ${sc.stalledAt}px of ${sc.maxY}px${sc.lock ? ` (${sc.lock})` : ''} — motion and colors below that point were not sampled`);
  if (diag.throttled) gaps.push('The inspection tab was throttled by Chrome (low frame rate) — JS-driven motion timings may be missing or wrong');
  if (r.blockedStylesheets?.length && !diag.keyframesFetched) gaps.push(`${r.blockedStylesheets.length} cross-origin stylesheet(s) unreadable — some @keyframes may be missing`);
  push('## Not captured', ...gaps.map((g) => '- ' + g), '');

  // Diagnostics
  push('## Capture diagnostics');
  push(`- Mode: ${diag.mode}${diag.fallbackReason ? ` (fallback: ${diag.fallbackReason})` : ''}`);
  push(`- Frame rate during capture: load ${diag.fpsLoad ?? '?'} fps, scroll ${diag.fpsScroll ?? '?'} fps${diag.throttled ? ' — THROTTLED' : ''}; page visibility: ${diag.visibility ?? '?'}`);
  const pageH = Math.max(r.meta?.pageHeight || 0, sc && sc.maxY !== undefined ? sc.maxY + 900 : 0);
  push(`- Viewport ${diag.viewport}, page height ${pageH}px${diag.heightCapped ? ' (full.jpg capped)' : ''}, ${diag.durationS}s`);
  if (sc) {
    const how = Object.entries(sc.methods || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none needed';
    const end = sc.reachedBottom ? 'reached the bottom' : sc.stalledAt !== undefined ? `stalled at ${sc.stalledAt}px of ${sc.maxY}px` : `stopped at ${sc.endY}px of ${sc.maxY}px (step limit)`;
    push(`- Scroll: ${sc.steps} steps, ${end}; scrolled the ${sc.mode === 'window' ? 'window' : `container ${sc.mode}`}; by ${how}`
      + `${sc.overshoots ? `; ${sc.overshoots} step(s) overshot (smooth-scroll momentum)` : ''}${sc.duplicateFrames ? `; ${sc.duplicateFrames} identical frame(s) dropped` : ''}`
      + `${sc.bypassedLock ? `. The page had scrolling locked (${sc.bypassedLock}); scrolled it directly, so wheel-driven effects below the fold may not have fired` : ''}`);
  }
  if (diag.containerUnboxed) push('- The page scrolls inside a container; full.jpg was taken with that container expanded to its full height');
  if (false) {
  }
  if (diag.consentHidden?.length) push(`- Hid ${diag.consentHidden.length} consent banner(s) before measuring: ${diag.consentHidden.slice(0, 3).join('; ')}${diag.consentUnlocked ? ' (and re-enabled page scrolling it had locked)' : ''}. seen.jpg still shows what you saw, banner included.`);
  if (diag.fixedHandled) push(`- ${diag.fixedHandled} fixed element(s) (nav, widgets) shown only at the top of full.jpg`);
  if (diag.errors?.length) push(`- Errors: ${diag.errors.join('; ')}`);
  push('');

  push('## Files');
  for (const f of files) push(`- ${f}`);
  push('');
  return L.join('\n');
}

// Swap the Note section of an existing clip.md (used when a note is added after clipping)
export function replaceNote(md, note) {
  const body = note && note.trim() ? cleanNote(note) : '_(no note)_';
  return md.replace(/## Note\n[\s\S]*?\n\n/, () => `## Note\n${body}\n\n`);
}

// one paragraph (blank lines would end the Note section)
export const cleanNote = (n) => String(n || '').trim().replace(/\n\s*\n+/g, '\n');
