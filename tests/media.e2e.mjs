// End-to-end test of media capture: Artspo's real inspector (extension/lib/inspector.js) drives headless
// Chromium over the DevTools protocol, through a small chrome.* shim, against a local test site that uses every
// kind of media (tests/media_site.py). Then it writes the clip folder the way background.js does, builds the
// catalogue, and checks that a public book carries none of the saved media.
//
//   node tests/media.e2e.mjs            needs Playwright for Node (npm i -g playwright, or NODE_PATH to it),
//                                       python3 with Pillow, and ffmpeg
//   node tests/media.e2e.mjs --url https://example.com/   inspect a real page instead (no assertions)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const urlFlag = process.argv.indexOf('--url');
const realUrl = urlFlag > 0 ? process.argv[urlFlag + 1] : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'artspo-media-'));
const lib = path.join(work, 'library');
let passed = 0;
const ok = (name) => { passed++; console.log('  ok', name); };

// ---- static servers: the extension's files (chrome.runtime.getURL) and the test site, with Range support
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ttf': 'font/ttf',
  '.riv': 'application/octet-stream', '.lottie': 'application/zip', '.md': 'text/markdown' };
function serve(dir, { ranges = [] } = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
      if (!p.startsWith(dir) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      const buf = fs.readFileSync(p);
      const type = MIME[path.extname(p)] || 'application/octet-stream';
      const range = req.headers.range && ranges.some((r) => p.endsWith(r)) && req.headers.range.match(/bytes=(\d+)-(\d*)/);
      if (range) { // like a video CDN: answer in pieces
        const start = +range[1], end = Math.min(range[2] ? +range[2] : start + 65535, buf.length - 1);
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' });
        return res.end(buf.subarray(start, end + 1));
      }
      res.writeHead(200, { 'content-type': type, 'content-length': buf.length });
      res.end(buf);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const ext = await serve(path.join(repo, 'extension'));
let site = null, url = realUrl;
if (!realUrl) {
  execFileSync('python3', [path.join(repo, 'tests/media_site.py'), path.join(work, 'site')], { stdio: 'ignore' });
  site = await serve(path.join(work, 'site'), { ranges: ['stream.mp4'] });
  url = `http://127.0.0.1:${site.port}/`;
}

// ---- chrome.* shim over Playwright's Chromium: tabs are pages, chrome.debugger is a CDP session
const browser = await chromium.launch(realUrl && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await browser.newContext();
const pages = new Map(), sessions = new Map(), onEvent = new Set(), onDetach = new Set();
let nextId = 1;
const newTab = async () => { const id = nextId++; pages.set(id, await ctx.newPage()); return id; };
globalThis.chrome = {
  runtime: { getURL: (p) => `http://127.0.0.1:${ext.port}/${p}` },
  tabs: { create: async () => ({ id: await newTab() }), remove: async (id) => pages.get(id)?.close() },
  windows: { create: async () => { const id = await newTab(); return { id, tabs: [{ id }] }; }, remove: async () => {} },
  debugger: {
    attach: async ({ tabId }) => {
      const cdp = await ctx.newCDPSession(pages.get(tabId));
      sessions.set(tabId, cdp);
      for (const m of ['Page.loadEventFired', 'Network.responseReceived', 'Network.loadingFinished']) cdp.on(m, (p) => onEvent.forEach((f) => f({ tabId }, m, p)));
    },
    sendCommand: ({ tabId }, method, params) => sessions.get(tabId).send(method, params),
    detach: async ({ tabId }) => sessions.get(tabId)?.detach().catch(() => {}),
    onEvent: { addListener: (f) => onEvent.add(f), removeListener: (f) => onEvent.delete(f) },
    onDetach: { addListener: (f) => onDetach.add(f), removeListener: (f) => onDetach.delete(f) },
  },
};

const { inspect } = await import(path.join(repo, 'extension/lib/inspector.js'));
const { buildClipMd } = await import(path.join(repo, 'extension/lib/clipmd.js'));
const { result, frames, diag, assets } = await inspect(url, () => {});
await browser.close();
diag.inspectedAt = '2026-11-03T17:00:00-08:00';

// ---- write the clip folder the way background.js does
const dir = path.join(lib, 'inbox', '2026-11-03_test_ab12');
const put = (rel, f) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.base64 != null ? Buffer.from(f.base64, 'base64') : f.text); };
for (const a of assets) put(a.path, a);
frames.forEach((f, i) => put(`filmstrip/${String(i + 1).padStart(2, '0')}.jpg`, { base64: f }));
const listed = [`assets/ — ${assets.length} files: the page's own media, listed under Media`];
const md = buildClipMd({ url, title: result.meta.title, collection: 'inbox', tags: [], note: 'media test', clippedAt: diag.inspectedAt }, result, diag, listed);
put('clip.md', { text: md });

if (realUrl) {
  console.log(md.slice(md.indexOf('## Media'), md.indexOf('## Motion')));
  console.log(`clip folder: ${dir}`);
  process.exit(0);
}

const m = result.assets;
const file = (rel) => fs.readFileSync(path.join(dir, rel));
const errs = diag.errors.filter((e) => !/full-page screenshot/.test(e)); // Node has no image decoder for full.jpg
assert.deepEqual(errs, []);
ok(`inspection ran clean and saved ${assets.length} media files`);

// vector art
const logo = m.svgs.find((s) => s.role === 'logo');
assert.ok(logo && logo.file.endsWith('_logo-fieldnote-home.svg'), JSON.stringify(m.svgs.map((s) => s.file)));
assert.ok(m.svgs.some((s) => s.role === 'illustration'));
const icons = m.svgs.filter((s) => s.role === 'icon');
assert.equal(icons.length, 7);
assert.match(md, /- Icon system: 7 line icons \(9 on the page\) on a 24×24 grid, stroke 1\.5px, round caps and joins, #17161A/);
ok('SVGs: logo, illustration and 7 icons, summarized as one icon system');
const star = icons.find((s) => s.n === 3);
const starSvg = file(star.file).toString();
assert.doesNotMatch(starSvg, /<use/);
assert.match(starSvg, /M12 3l2\.7 5\.6/);
assert.match(starSvg, /stroke="rgb\(23, 22, 26\)"/);
assert.match(starSvg, /stroke-width="1\.5px"/);
assert.match(starSvg, /viewBox="0 0 24 24"/);
ok('a sprite icon (<use href="#…">) is saved as a standalone drawing, with the CSS stroke written in');
assert.match(file(m.svgs.find((s) => s.role === 'illustration').file).toString(), /linearGradient/);
ok('an illustration keeps its gradient');

// images
const img = (name) => m.images.find((x) => x.url.endsWith(name));
assert.equal(img('/hero.jpg').role, 'hero');
assert.equal(img('/hero.jpg').fit, 'cover');
assert.equal(img('/hero.jpg').radius, '24px');
assert.equal(img('/photo.jpg').filter, 'grayscale(1)');
assert.notEqual(img('/photo.jpg').role, 'poster');
assert.equal(img('/avatar.png').role, 'avatar');
assert.equal(img('/hover.png').kind, 'loaded');
assert.ok(img('/lazy.webp'), 'the lazy image below the fold loads during the scroll pass');
assert.ok(m.images.some((x) => x.url.startsWith('inline') && x.format === 'svg'), 'data: URI image');
assert.ok(!m.images.some((x) => /pixel\.gif/.test(x.url)), 'tracking pixel skipped');
assert.ok(file(img('/hero.jpg').file).equals(fs.readFileSync(path.join(work, 'site/hero.jpg'))), 'saved byte for byte');
ok('images: roles, treatments (cover, radius, grayscale), lazy, inline and unplaced ones; pixel skipped; bytes exact');

// video
const v = (name) => m.videos.find((x) => x.src?.endsWith(name));
assert.ok(v('/loop.mp4').file && v('/loop.mp4').autoplay && v('/loop.mp4').loop);
assert.equal(v('/loop.mp4').posterFile, img('/photo.jpg').file);
assert.ok(file(v('/stream.mp4').file).equals(fs.readFileSync(path.join(work, 'site/stream.mp4'))));
ok('video: saved with its poster; one served in pieces (HTTP 206) is saved whole');

// animation files
assert.equal(m.lottie.length, 2);
const orbit = m.lottie.find((l) => l.name === 'Hero orbit');
assert.deepEqual([orbit.fps, orbit.seconds, orbit.frames, orbit.layers, orbit.keyframes, orbit.holds], [60, 3, 180, 2, 8, 1]);
assert.deepEqual(orbit.eases[0], { e: 'cubic-bezier(0.33, 0, 0.67, 1)', n: 3 });
assert.deepEqual(orbit.markers, ['intro', 'loop']);
const badge = m.lottie.find((l) => l.file.endsWith('.lottie'));
assert.equal(badge.fps, 30);
assert.ok(!m.lottie.some((l) => /api\.json/.test(l.src)), 'a JSON that isn’t Lottie is left alone');
assert.equal(m.rive.length, 1);
ok('Lottie (.json and .lottie) read for fps, length, keyframes, easings and markers; Rive saved');

// icons, share, fonts
assert.equal(m.icons.length, 2);
assert.ok(m.share && file(m.share.file).equals(fs.readFileSync(path.join(work, 'site/share.jpg'))));
assert.deepEqual(m.fonts, [{ source: 'self-hosted', format: 'ttf', n: 1 }]);
assert.ok(!assets.some((a) => /\.ttf$/.test(a.path)), 'font files are never saved');
ok('site icons and share image saved; webfont listed by source, not saved');

// clip.md
assert.match(md, /^## Media\n\d+ files in assets\//m);
assert.match(md, /Rive state machines — the \.riv file is saved/);
assert.doesNotMatch(md, /Lottie animation files —/);
assert.match(md, /autoplay video\(s\) — motion is baked into video, not code \(2 saved/);
ok('clip.md: Media section, and Not captured updated for what is now saved');

// catalogue: private shows the media; a public book carries none of it
const cat = path.join(repo, 'extension/skills/artspo/catalogue.py');
execFileSync('python3', [cat, lib], { stdio: 'ignore' });
const html = fs.readFileSync(path.join(lib, 'catalogue.html'), 'utf8');
assert.match(html, /inbox\/2026-11-03_test_ab12\/assets\/svg\/01_logo-fieldnote-home\.svg/);
const book = path.join(work, 'book');
execFileSync('python3', [cat, lib, '--public', '--site', book, '--url', 'https://someone.github.io/book/'], { stdio: 'ignore' });
const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]));
const shipped = all(book);
assert.ok(!shipped.some((f) => f.includes('assets')), shipped.filter((f) => f.includes('assets')).join(', '));
for (const f of shipped.filter((f) => /\.(html|md|json|txt)$/.test(f))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /assets\/(svg|img|video|lottie)\//, f);
const sizes = new Set(shipped.map((f) => fs.statSync(f).size));
assert.ok(!sizes.has(fs.statSync(path.join(work, 'site/hero.jpg')).size), 'no saved image bytes in the book');
ok('catalogue lists the media; a public book has none of it');

console.log(`\n${passed} checks passed`);
fs.rmSync(work, { recursive: true, force: true });
ext.srv.close(); site?.srv.close();
