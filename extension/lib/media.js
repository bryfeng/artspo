// The page's own media, saved into the clip's assets/ folder: vector art, images, short videos, Lottie and Rive
// animations, the site icon and the share image. extract.js says what's on the page and how it's shown; this
// module finds each file among what the page loaded and takes its bytes from Chrome's network cache, so nothing
// is downloaded twice. It falls back to fetching a file only when the cache doesn't have it (a cached repeat
// visit, a video streamed in ranges) and for the share image, which pages don't load themselves.
//
// Pure helpers (names, Lottie reading, unzip) don't touch chrome.*, so they can be tested in Node.

export const LIMITS = {
  svgs: 60, images: 80, imageBytes: 8e6, videos: 4, videoBytes: 15e6,
  lottie: 8, lottieBytes: 5e6, rive: 4, riveBytes: 5e6, totalBytes: 60e6,
};

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp', 'image/apng': 'png',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'application/json': 'json', 'text/json': 'json',
};
const KNOWN = /^(png|jpe?g|webp|avif|gif|svg|ico|bmp|mp4|webm|mov|m4v|json|lottie|riv)$/;

export function extOf(mime, url) {
  const m = EXT[String(mime || '').split(';')[0].trim().toLowerCase()];
  if (m) return m;
  const e = (String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,6})$/i) || [])[1]?.toLowerCase();
  if (e && KNOWN.test(e)) return e === 'jpeg' ? 'jpg' : e;
  if (String(url).startsWith('data:image/svg')) return 'svg';
  return 'bin';
}

// "https://x.com/static/Hero-Image_2x.final.webp?w=800" → "hero-image-2x-final"
export function nameOf(url, hint) {
  const base = hint || decodeURIComponent((String(url || '').split(/[?#]/)[0].split('/').pop() || '').replace(/\.[a-z0-9]{2,6}$/i, ''));
  return String(base).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, ' ').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 32) || 'file';
}

const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- Lottie
export function isLottie(a) {
  return !!a && typeof a === 'object' && Number.isFinite(a.fr) && 'ip' in a && 'op' in a && Array.isArray(a.layers);
}

// What a Lottie file says about its motion: frame rate, length, size, layers, keyframes and their easing curves.
export function lottieSummary(a) {
  const round = (n) => Math.round(n * 100) / 100;
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  let layers = 0, keyframes = 0, holds = 0;
  const eases = new Map();
  const countLayers = (ls) => { for (const l of ls || []) if (l && typeof l === 'object') layers++; };
  countLayers(a.layers);
  for (const as of a.assets || []) countLayers(as?.layers);
  const visit = (o, depth = 0) => {
    if (depth > 60 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) visit(x, depth + 1); return; }
    if (o.a === 1 && Array.isArray(o.k)) { // an animated property: its keyframes, each easing into the next
      o.k.forEach((k, i) => {
        if (!k || typeof k !== 'object' || !('t' in k)) return;
        keyframes++;
        if (k.h === 1) { holds++; return; }
        if (i === o.k.length - 1 || !k.o || !k.i) return;
        const b = [first(k.o.x), first(k.o.y), first(k.i.x), first(k.i.y)].map(Number);
        if (!b.every(Number.isFinite)) return;
        const e = `cubic-bezier(${b.map(round).join(', ')})`;
        eases.set(e, (eases.get(e) || 0) + 1);
      });
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v, depth + 1);
  };
  visit(a.layers);
  visit(a.assets);
  const frames = a.op - a.ip;
  return {
    name: a.nm || undefined, fps: round(a.fr), frames: Math.round(frames), seconds: round(frames / a.fr), w: a.w, h: a.h,
    layers, keyframes, holds, eases: [...eases].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([e, n]) => ({ e, n })),
    markers: (a.markers || []).map((m) => m?.cm).filter(Boolean).slice(0, 6),
  };
}

// dotLottie (.lottie) is a zip with animations/<id>.json inside. Read the first animation.
export async function unzipFirstJson(bytes, dir = 'animations/') {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.startsWith(dir) || !name.endsWith('.json')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) return dec.decode(data);
    if (method !== 8 || typeof DecompressionStream === 'undefined') return null;
    const out = new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    return await out.text();
  }
  return null;
}

// ---------------------------------------------------------------- bytes
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(buf) {
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
const sizeOf = (d) => (d.base64 != null ? Math.floor(d.base64.length * 0.75) : new TextEncoder().encode(d.text || '').length);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

// data:image/svg+xml;utf8,%3Csvg…  /  data:image/png;base64,iVBOR…
export function dataUri(url) {
  const m = String(url).match(/^data:([^,]*?),(.*)$/s);
  if (!m) return null;
  const [mime, ...params] = m[1].split(';');
  if (params.includes('base64')) return { base64: m[2].replace(/\s+/g, ''), mime: mime || 'application/octet-stream' };
  try { return { text: decodeURIComponent(m[2]), mime: mime || 'text/plain' }; } catch { return { text: m[2], mime: mime || 'text/plain' }; }
}

async function imageSize(d) {
  if (typeof createImageBitmap === 'undefined' || d.base64 == null) return null;
  try {
    const bmp = await createImageBitmap(new Blob([b64ToBytes(d.base64)]));
    const s = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return s;
  } catch { return null; }
}

// ---------------------------------------------------------------- collecting
// s: the inspector's DevTools session; inv: extract.js's media inventory; net: Map url → response record
// Returns { files: [{ path: 'assets/…', base64|text, mime }], manifest }.
// A server that answers a media address with its HTML page (a 404 page, an app shell, a video with no source yet)
export function isWebPage(d) {
  if (/text\/html|application\/xhtml/i.test(d.mime || '')) return true;
  let head = '';
  if (d.text != null) head = d.text.slice(0, 256);
  else if (d.base64) { try { head = new TextDecoder().decode(b64ToBytes(d.base64.slice(0, 344))); } catch {} }
  return /^\uFEFF?\s*<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i.test(head);
}

export async function collectMedia(s, inv, net, { limits = LIMITS, fetchFn = fetch, pageUrl = '' } = {}) {
  const files = [];
  const man = { svgs: [], images: [], videos: [], lottie: [], rive: [], icons: [], share: null, fonts: [], skipped: [], counts: inv?.counts,
    left: { ui: 0, social: 0, partner: 0, chrome: 0, small: 0 }, logoWall: null };
  if (!inv || inv.error) { if (inv?.error) man.error = inv.error; return { files, manifest: man }; }
  let total = 0;
  const fits = (n, cap) => n <= cap && total + n <= limits.totalBytes;
  const put = (path, d, mime) => { files.push({ path, ...d, mime }); total += sizeOf(d); };
  const skip = (what, why) => { if (man.skipped.length < 30) man.skipped.push({ what, why }); };

  // bytes for a URL: data: URI, then the network cache, then a fetch
  const cacheBody = async (rec) => {
    if (!rec || rec.status >= 300 || rec.partial) return null;
    try {
      const r = await withTimeout(s.send('Network.getResponseBody', { requestId: rec.id }), 10000);
      return r.base64Encoded ? { base64: r.body } : { text: r.body };
    } catch { return null; }
  };
  const fetchBody = async (url, maxBytes, asText) => {
    try {
      const res = await withTimeout(fetchFn(url, { credentials: 'include' }), 15000);
      if (!res.ok) return null;
      const len = +res.headers.get('content-length') || 0;
      if (len && len > maxBytes) return { tooBig: len };
      const mime = res.headers.get('content-type') || '';
      if (asText) return { text: await res.text(), mime };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > maxBytes) return { tooBig: buf.length };
      return { base64: bytesToB64(buf), mime };
    } catch { return null; }
  };
  const bodyOf = async (url, maxBytes, opts = {}) => {
    const d = await rawBody(url, maxBytes, opts);
    return d && !d.tooBig && isWebPage(d) ? { notMedia: true } : d;
  };
  const rawBody = async (url, maxBytes, { asText = false, allowFetch = true } = {}) => {
    if (url.startsWith('data:')) return dataUri(url);
    const rec = net.get(url);
    let d = await cacheBody(rec);
    if (d) {
      if (asText && d.base64 != null) d = { text: new TextDecoder().decode(b64ToBytes(d.base64)) };
      return { ...d, mime: rec.mime };
    }
    return allowFetch ? fetchBody(url, maxBytes, asText) : null;
  };
  const WEB_PAGE = 'the address returned a web page, not the file';

  // -- what's worth saving: the site's own logo and the main content's media. UI icons (arrows, chevrons, menus),
  // other companies' marks, and the nav, footer and overlays are counted and described instead.
  const leave = (x, svg) => {
    if (x.role === 'logo') return null;
    if (/social|brand/.test(x.role || '')) return 'social';
    if (x.role === 'partner logo') return 'partner';
    if (svg && x.role === 'icon') return !x.chrome && !x.control && Math.max(x.w, x.h) >= 32 ? null : 'ui';
    if (!svg && x.placed && x.w && x.h && x.w <= 48 && x.h <= 48) return 'small';
    if (x.chrome) return 'chrome';
    return null;
  };
  const wall = [];
  const leaveOut = (x, why) => { man.left[why] += x.n || 1; if (why === 'partner') wall.push(x); };

  // -- vector art: markup straight from the page
  // the site's logo, then larger art and partner logos, then its icons, then social and other brands' icons
  const order = (s) => (s.role === 'logo' ? 0 : s.role === 'icon' ? 2 : /social|brand/.test(s.role || '') ? 3 : 1);
  const svgs = [...(inv.svgs || [])].sort((a, b) => order(a) - order(b) || b.n - a.n || a.y - b.y);
  let i = 0;
  let logos = 0;
  for (const v of svgs) {
    const why = leave(v, true) || (v.role === 'logo' && logos >= 3 ? 'chrome' : null);
    if (why) {
      leaveOut(v, why);
      const { markup, key, ...meta } = v;
      if (man.svgs.length < 400) man.svgs.push({ ...meta, left: why }); // kept for the icon-system line
      continue;
    }
    if (v.role === 'logo') logos++;
    if (i >= limits.svgs) { skip(`${svgs.length - i} more SVGs`, `over the ${limits.svgs}-file limit`); break; }
    if (!v.markup) { skip(`SVG ${v.w}×${v.h}${v.role ? ' (' + v.role + ')' : ''}`, 'markup over 200 KB'); continue; }
    const d = { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + v.markup };
    if (!fits(sizeOf(d), 1e6)) continue;
    const file = `assets/svg/${pad(++i)}_${nameOf('', [v.role || 'svg', v.label].filter(Boolean).join(' '))}.svg`;
    put(file, d, 'image/svg+xml');
    const { markup, key, ...meta } = v;
    man.svgs.push({ file, ...meta });
  }

  // -- images: placed on the page first (biggest, logos and heroes up front), then loaded-but-unplaced ones
  const seen = new Set();
  const cands = [];
  for (const im of inv.images || []) cands.push({ ...im, placed: true });
  for (const v of inv.videos || []) {
    if (v.poster && !(inv.images || []).some((x) => x.url === v.poster)) cands.push({ url: v.poster, kind: 'poster', role: 'poster', w: v.w, h: v.h, placed: true });
  }
  for (const [url, rec] of net) {
    if (rec.type === 'Image' && !(inv.images || []).some((x) => x.url === url) && (rec.size || 0) >= 20000) cands.push({ url, kind: 'loaded', role: null, placed: false });
  }
  const iconUrls = new Set((inv.icons || []).map((x) => x.url));
  const rank = (c) => (c.role === 'logo' ? 3 : c.role === 'hero' ? 2 : c.placed ? 1 : 0) * 1e9 + (c.w || 0) * (c.h || 0);
  cands.sort((a, b) => rank(b) - rank(a));
  i = 0;
  for (const c of cands) {
    if (seen.has(c.url) || iconUrls.has(c.url) || c.url === inv.share) continue;
    seen.add(c.url);
    const why = leave(c, false);
    if (why) { leaveOut(c, why); continue; }
    if (i >= limits.images) { skip(`${cands.length - i} more images`, `over the ${limits.images}-image limit`); break; }
    const d = await bodyOf(c.url, limits.imageBytes, { allowFetch: c.placed });
    if (!d) { if (c.placed) skip(c.url.startsWith('data:') ? 'an inline image' : c.url, 'not in the cache and could not be fetched'); continue; }
    if (d.notMedia) { if (c.placed) skip(c.url, WEB_PAGE); continue; }
    if (d.tooBig || !fits(sizeOf(d), limits.imageBytes)) { skip(c.url, `over ${Math.round(limits.imageBytes / 1e6)} MB`); continue; }
    const ext = extOf(d.mime, c.url);
    if (ext === 'bin' || ext === 'json') continue;
    const file = `assets/img/${pad(++i)}_${nameOf(c.url.startsWith('data:') ? '' : c.url, c.url.startsWith('data:') ? (c.role || 'inline') : '')}.${ext}`;
    put(file, d, d.mime || 'application/octet-stream');
    const size = c.nw ? { w: c.nw, h: c.nh } : await imageSize(d);
    const { url, placed, n, ...meta } = c;
    man.images.push({ file, url: url.startsWith('data:') ? 'inline (data: URI)' : url, ...meta, fileW: size?.w, fileH: size?.h, n, bytes: sizeOf(d), format: ext });
  }

  // -- video: whole files only, small ones; streamed or long videos get their facts and poster
  i = 0;
  for (const v of inv.videos || []) {
    if (v.chrome || (v.w && v.h && v.w <= 48 && v.h <= 48)) { man.left.chrome += 1; continue; }
    const meta = { ...v, posterFile: man.images.find((x) => x.url === v.poster)?.file };
    delete meta.url;
    if (v.streamed || !v.url) { man.videos.push({ ...meta, notSaved: 'streamed in pieces (no single file to save)' }); continue; }
    if (i >= limits.videos) { man.videos.push({ ...meta, src: v.url, notSaved: `over the ${limits.videos}-video limit` }); continue; }
    const rec = net.get(v.url);
    const known = rec?.total || rec?.length || 0;
    if (known > limits.videoBytes) { man.videos.push({ ...meta, src: v.url, notSaved: `${Math.round(known / 1e6)} MB, over the ${Math.round(limits.videoBytes / 1e6)} MB limit` }); continue; }
    const d = await bodyOf(v.url, limits.videoBytes);
    if (d?.notMedia) { man.videos.push({ ...meta, src: v.url, notSaved: WEB_PAGE }); continue; }
    if (!d || d.tooBig || !fits(sizeOf(d), limits.videoBytes)) {
      man.videos.push({ ...meta, src: v.url, notSaved: d?.tooBig ? `over the ${Math.round(limits.videoBytes / 1e6)} MB limit` : 'could not be read' });
      continue;
    }
    const file = `assets/video/${pad(++i)}_${nameOf(v.url)}.${extOf(d.mime, v.url).replace('bin', 'mp4')}`;
    put(file, d, d.mime || 'video/mp4');
    man.videos.push({ file, src: v.url, ...meta, bytes: sizeOf(d) });
  }

  // -- Lottie: JSON (or .lottie zips) the page declared or loaded
  const lottieUrls = new Set(inv.lottie || []);
  for (const [url, rec] of net) {
    const looksJson = /json/i.test(rec.mime || '') || /\.json(\?|$)/i.test(url);
    if ((looksJson && (rec.size || rec.length || 0) < limits.lottieBytes) || /\.lottie(\?|$)/i.test(url)) lottieUrls.add(url);
  }
  i = 0;
  let checked = 0;
  for (const url of lottieUrls) {
    if (i >= limits.lottie || checked++ > 40) break;
    const zip = /\.lottie(\?|$)/i.test(url);
    const d = await bodyOf(url, limits.lottieBytes, { asText: !zip, allowFetch: (inv.lottie || []).includes(url) });
    if (!d || d.tooBig) continue;
    let json, text = d.text;
    try {
      if (zip) text = await unzipFirstJson(b64ToBytes(d.base64));
      json = text ? JSON.parse(text) : null;
    } catch { json = null; }
    if (!isLottie(json)) continue;
    if (!fits(sizeOf(d), limits.lottieBytes)) { skip(url, 'over the size limit'); continue; }
    const file = `assets/lottie/${pad(++i)}_${nameOf(url, json.nm && !/^(comp|composition)\s*\d*$/i.test(json.nm) ? json.nm : '')}.${zip ? 'lottie' : 'json'}`;
    put(file, zip ? { base64: d.base64 } : { text: d.text }, zip ? 'application/zip' : 'application/json');
    man.lottie.push({ file, src: url, ...lottieSummary(json) });
  }

  // -- Rive
  i = 0;
  for (const [url, rec] of net) {
    if (!/\.riv(\?|$)/i.test(url) || i >= limits.rive) continue;
    const d = await bodyOf(url, limits.riveBytes, { allowFetch: false });
    if (d?.notMedia) { skip(url, WEB_PAGE); continue; }
    if (!d || d.tooBig || !fits(sizeOf(d), limits.riveBytes)) { skip(url, 'Rive file could not be read'); continue; }
    const file = `assets/rive/${pad(++i)}_${nameOf(url)}.riv`;
    put(file, d.text != null ? { base64: bytesToB64(new TextEncoder().encode(d.text)) } : d, 'application/octet-stream');
    man.rive.push({ file, src: url, bytes: sizeOf(d) });
  }

  // -- the logo wall, described once: how many, at what size, in what treatment
  if (wall.length) {
    const top = (f) => { const c = {}; for (const x of wall) { const k = f(x); if (k != null && k !== '') c[k] = (c[k] || 0) + 1; } const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return e && e[1] >= wall.length / 2 ? e[0] : undefined; };
    man.logoWall = {
      n: wall.reduce((t, x) => t + (x.n || 1), 0),
      size: top((x) => (x.w && x.h ? `${x.w}×${x.h}` : null)),
      filter: top((x) => x.filter), opacity: top((x) => x.opacity), blend: top((x) => x.blend),
      ink: top((x) => (x.colors?.length === 1 ? x.colors[0] : null)),
    };
  }

  // -- site icon (the biggest one) and share image
  const icons = [...(inv.icons || [])].sort((a, b) => (parseInt(b.sizes) || (b.type === 'image/svg+xml' ? 999 : 0)) - (parseInt(a.sizes) || (a.type === 'image/svg+xml' ? 999 : 0)));
  i = 0;
  for (const ic of icons) {
    if (i >= 1) break; // the best one: the site's mark at its largest
    const d = await bodyOf(ic.url, 1e6);
    if (d?.notMedia) { skip(ic.url, WEB_PAGE); continue; }
    if (!d || d.tooBig || !fits(sizeOf(d), 1e6)) continue;
    const ext = extOf(d.mime || ic.type, ic.url);
    if (ext === 'bin') continue;
    const file = `assets/icon/${pad(++i)}_${nameOf('', ic.rel.replace(/\s+/g, '-'))}.${ext}`;
    put(file, d, d.mime || ic.type || 'image/png');
    const size = await imageSize(d);
    man.icons.push({ file, src: ic.url, rel: ic.rel, sizes: ic.sizes || (size ? `${size.w}x${size.h}` : undefined) });
  }
  if (inv.share) {
    const d = await bodyOf(inv.share, 4e6);
    if (d?.notMedia) skip(inv.share, WEB_PAGE);
    if (d && !d.notMedia && !d.tooBig && fits(sizeOf(d), 4e6)) {
      const ext = extOf(d.mime, inv.share);
      if (ext !== 'bin') {
        const file = `assets/share.${ext}`;
        put(file, d, d.mime || 'image/jpeg');
        const size = await imageSize(d);
        man.share = { file, src: inv.share, w: size?.w, h: size?.h };
      }
    }
  }

  // -- webfonts: where they come from, never the files (fonts are licensed)
  const fonts = new Map();
  const site = (h) => String(h || '').split('.').slice(-2).join('.');
  let pageSite = '';
  try { pageSite = site(new URL(pageUrl).hostname); } catch {}
  for (const [url, rec] of net) {
    if (rec.type !== 'Font') continue;
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    const source = /gstatic|googleapis/.test(host) ? 'Google Fonts' : /typekit|adobe/.test(host) ? 'Adobe Fonts' : /fontawesome/.test(host) ? 'Font Awesome'
      : /fonts\.net|monotype/.test(host) ? 'Monotype' : !host || site(host) === pageSite ? 'self-hosted' : host;
    const fmt = extOf(rec.mime, url) === 'bin' ? ((url.split(/[?#]/)[0].match(/\.(woff2?|ttf|otf|eot)$/i) || [])[1] || 'font') : extOf(rec.mime, url);
    const k = `${source}|${fmt}`;
    fonts.set(k, (fonts.get(k) || 0) + 1);
  }
  man.fonts = [...fonts].map(([k, n]) => { const [source, format] = k.split('|'); return { source, format, n }; });
  man.bytes = total;
  return { files, manifest: man };
}
