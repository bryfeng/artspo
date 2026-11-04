#!/usr/bin/env python3
"""One canvas of every visual your clips saved: a private page to browse the library's art, imagery and motion.

  python3 canvas.py <library>                 writes <library>/canvas.html (open it in a browser)
  python3 canvas.py <library> --collection C  only one collection

Shows the files in each clip's assets/ folders, with clip.md's description where it has one; curated-out files
are gone from those folders, so they never show. The page loads
the files from the library folder itself: nothing is copied or uploaded, and it isn't for sharing.
"""
import argparse, html, json, os, pathlib, re

KIND = {"svg": "art", "img": "image", "video": "video", "lottie": "motion", "rive": "motion"}
SKIP = {"patterns", "reports", "works", "skills", "books"}


def frontmatter(text):
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    out = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def items_of(lib, collection=None):
    """Every saved visual listed under a clip's ## Media whose file is still there."""
    out = []
    for coll in sorted(p for p in lib.iterdir() if p.is_dir() and p.name not in SKIP and not p.name.startswith((".", "_"))):
        if collection and coll.name != collection:
            continue
        for d in sorted(c for c in coll.iterdir() if (c / "clip.md").exists()):
            text = (d / "clip.md").read_text(errors="replace")
            fm = frontmatter(text)
            if fm.get("status") == "superseded" or "## Media" not in text:
                continue
            media = text.split("## Media", 1)[1].split("\n## ", 1)[0]
            url = fm.get("url", "")
            site = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
            base = f"{coll.name}/{d.name}"
            seen = set()
            for line in media.splitlines():
                m = re.match(r"- `(assets/([a-z]+)/[^`]+)`(?: — (.*))?", line)
                if not m or m.group(1) in seen or not (d / m.group(1)).exists() or m.group(2) not in KIND:
                    continue
                seen.add(m.group(1))
                label = re.sub(r"`[^`]+`", "", m.group(3) or "").strip(" ,;")[:180]
                out.append(dict(src=f"{base}/{m.group(1)}", kind=KIND[m.group(2)], label=label, site=site,
                                title=fm.get("title", d.name), url=url, clip=f"{base}/clip.md", collection=fm.get("collection", coll.name)))
            # clip.md names the first 16 SVGs and 20 images ("…and N more"): the rest are on disk
            for folder, kind in KIND.items():
                for f in sorted((d / "assets" / folder).glob("*")) if (d / "assets" / folder).is_dir() else []:
                    rel = f"assets/{folder}/{f.name}"
                    if f.is_file() and rel not in seen:
                        seen.add(rel)
                        out.append(dict(src=f"{base}/{rel}", kind=kind, label="", site=site, title=fm.get("title", d.name),
                                        url=url, clip=f"{base}/clip.md", collection=fm.get("collection", coll.name)))
    return out


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artspo canvas</title>
<style>
:root { --ground:#E9ECEF; --sheet:#F8F9FA; --ink:#14171B; --ink-2:#4E5661; --ink-3:#7C8590; --rule:#CFD5DC; --idx:#2C5BD0;
  --font:"Schibsted Grotesk","Helvetica Neue",Helvetica,Arial,sans-serif; --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --chk:#E2E6EA; --tile:240px; --ease:cubic-bezier(0.33,1,0.68,1); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ground:#101215; --sheet:#191C21; --ink:#E9ECEF; --ink-2:#A7AFB9; --ink-3:#737C87; --rule:#2B3139; --idx:#86A8FF; --chk:#21252B; color-scheme:dark; } }
:root[data-theme="dark"] { --ground:#101215; --sheet:#191C21; --ink:#E9ECEF; --ink-2:#A7AFB9; --ink-3:#737C87; --rule:#2B3139; --idx:#86A8FF; --chk:#21252B; color-scheme:dark; }
* { box-sizing:border-box; } [hidden] { display:none !important; }
body { margin:0; background:var(--ground); color:var(--ink); font:400 14px/1.45 var(--font); }
button { font:inherit; color:inherit; }
:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
header { position:sticky; top:0; z-index:5; background:var(--ground); border-bottom:1px solid var(--rule); }
.bar { display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; padding:12px max(16px, 2vw); }
.brand { display:flex; align-items:baseline; gap:10px; margin-right:auto; }
.brand b { font-weight:700; font-size:17px; letter-spacing:-0.01em; } .brand span, .count { color:var(--ink-3); font:12px var(--mono); }
.chips { display:flex; flex-wrap:wrap; gap:4px; }
.chip { height:30px; padding:0 11px; border:1px solid transparent; border-radius:2px; background:none; color:var(--ink-2); cursor:pointer; white-space:nowrap; }
.chip:hover { background:var(--sheet); color:var(--ink); }
.chip[aria-pressed="true"] { background:var(--sheet); color:var(--ink); border-color:var(--rule); }
.chip .n { font:11px var(--mono); color:var(--ink-3); margin-left:6px; }
.tools { display:flex; align-items:center; gap:10px; }
.tools input[type=range] { width:110px; accent-color:var(--ink); }
.grid { columns:var(--tile); column-gap:12px; padding:16px max(16px, 2vw) 80px; }
figure { break-inside:avoid; margin:0 0 12px; background:var(--sheet); border:1px solid var(--rule); border-radius:2px; cursor:zoom-in; overflow:hidden;
  opacity:0; transform:translateY(8px); transition:opacity 320ms var(--ease), transform 320ms var(--ease); }
figure.in { opacity:1; transform:none; }
.media { display:grid; place-items:center; min-height:90px;
  background:repeating-conic-gradient(var(--chk) 0 25%, transparent 0 50%) 0 0/14px 14px; }
.media img, .media video { display:block; width:100%; height:auto; max-height:70vh; object-fit:contain; }
.media.vec img { width:auto; max-width:86%; max-height:260px; padding:18px 0; }
.media .file { font:12px var(--mono); color:var(--ink-3); padding:36px 12px; text-align:center; }
figcaption { display:flex; justify-content:space-between; gap:8px; padding:6px 9px; font:11px var(--mono); color:var(--ink-3); }
figcaption b { font-weight:500; color:var(--ink-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tag { flex:none; text-transform:uppercase; letter-spacing:0.04em; }
.tag.video, .tag.motion { color:var(--idx); }
.empty { padding:80px 20px; text-align:center; color:var(--ink-3); }
dialog { width:min(1200px, 94vw); max-height:92vh; padding:0; border:1px solid var(--rule); border-radius:2px; background:var(--sheet); color:var(--ink); }
dialog::backdrop { background:rgba(10,12,15,.72); }
.view { display:grid; grid-template-columns:minmax(0,1fr) 300px; max-height:92vh; }
.view .media { min-height:60vh; } .view .media img, .view .media video { max-height:88vh; width:auto; max-width:100%; }
.view .media.vec img { max-width:80%; max-height:70vh; }
.side { padding:18px; border-left:1px solid var(--rule); overflow:auto; display:flex; flex-direction:column; gap:12px; }
.side h2 { margin:0; font-size:17px; line-height:1.25; } .side p { margin:0; color:var(--ink-2); }
.side .k { font:11px var(--mono); color:var(--ink-3); text-transform:uppercase; letter-spacing:.04em; }
.side a { color:var(--idx); text-decoration:none; } .side a:hover { text-decoration:underline; }
.side .row { display:flex; gap:8px; margin-top:auto; } .side button { height:32px; padding:0 12px; border:1px solid var(--rule); border-radius:2px; background:none; cursor:pointer; }
@media (max-width:760px) { .view { grid-template-columns:1fr; } .side { border-left:0; border-top:1px solid var(--rule); } .tools input[type=range] { display:none; } }
@media (prefers-reduced-motion: reduce) { figure { transition:none; opacity:1; transform:none; } }
</style></head>
<body>
<header><div class="bar">
  <div class="brand"><b>Canvas</b><span>__SUB__</span></div>
  <div class="chips" id="kinds"></div>
  <div class="tools"><span class="count" id="count"></span>
    <input type="range" id="size" min="160" max="420" step="20" value="240" aria-label="Tile size">
    <button class="chip" id="shuffle" title="Shuffle the order">Shuffle</button>
    <button class="chip" id="theme" title="Switch light or dark">Dark</button></div>
</div><div class="bar" style="padding-top:0"><div class="chips" id="colls"></div></div></header>
<main class="grid" id="grid"></main>
<p class="empty" id="empty" hidden>Nothing here. Try another filter.</p>
<dialog id="dlg"><div class="view"><div class="media" id="vmedia"></div><div class="side" id="vside"></div></div></dialog>
<script>
const ITEMS = __DATA__;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { return localStorage.getItem('artspo-canvas-' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('artspo-canvas-' + k, v); } catch {} } };
const KINDS = [['all', 'Everything'], ['art', 'Art'], ['image', 'Imagery'], ['video', 'Video'], ['motion', 'Motion']];
let kind = 'all', coll = 'all', order = ITEMS.map((_, i) => i);
const colls = ['all', ...new Set(ITEMS.map((x) => x.collection))];
const chip = (label, n, on, fn) => { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', on);
  b.innerHTML = `${esc(label)}<span class="n">${n}</span>`; b.onclick = fn; return b; };
function chips() {
  const k = $('kinds'); k.replaceChildren(...KINDS.map(([id, label]) => chip(label, ITEMS.filter((x) => (id === 'all' || x.kind === id) && (coll === 'all' || x.collection === coll)).length, id === kind, () => { kind = id; render(); })));
  const c = $('colls'); c.replaceChildren(...colls.map((id) => chip(id === 'all' ? 'All collections' : id, ITEMS.filter((x) => (id === 'all' || x.collection === id) && (kind === 'all' || x.kind === kind)).length, id === coll, () => { coll = id; render(); })));
}
function mediaEl(x, big) {
  const box = document.createElement('div'); box.className = 'media' + (x.kind === 'art' ? ' vec' : '');
  if (x.kind === 'video') {
    const v = document.createElement('video'); v.src = x.src; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
    if (big) { v.controls = true; v.autoplay = true; } box.append(v);
  } else if (x.kind === 'motion') {
    box.innerHTML = `<div class="file">${esc(x.src.split('/').pop())}<br>${esc(x.label || 'animation file')}</div>`;
  } else {
    const im = new Image(); im.loading = 'lazy'; im.decoding = 'async'; im.src = x.src; im.alt = x.label || '';
    im.onerror = () => { box.innerHTML = `<div class="file">${esc(x.src.split('/').pop())}</div>`; }; box.append(im);
  }
  return box;
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
  e.target.classList.toggle('in', e.isIntersecting || e.target.classList.contains('in'));
  const v = e.target.querySelector('video'); if (v) e.isIntersecting ? v.play().catch(() => {}) : v.pause();
}), { rootMargin: '200px' }) : null;
function render() {
  chips();
  const shown = order.map((i) => ITEMS[i]).filter((x) => (kind === 'all' || x.kind === kind) && (coll === 'all' || x.collection === coll));
  $('count').textContent = `${shown.length} of ${ITEMS.length}`;
  $('empty').hidden = !!shown.length;
  const g = $('grid'); g.replaceChildren();
  for (const x of shown) {
    const f = document.createElement('figure'); f.tabIndex = 0;
    f.append(mediaEl(x, false));
    const cap = document.createElement('figcaption'); cap.innerHTML = `<b>${esc(x.site || x.title)}</b><span class="tag ${x.kind}">${x.kind}</span>`; f.append(cap);
    f.onclick = () => open(x); f.onkeydown = (e) => { if (e.key === 'Enter') open(x); };
    g.append(f); io ? io.observe(f) : f.classList.add('in');
  }
}
function open(x) {
  $('vmedia').replaceWith(Object.assign(mediaEl(x, true), { id: 'vmedia' }));
  $('vside').innerHTML = `<div class="k">${esc(x.collection)} · ${esc(x.kind)}</div><h2>${esc(x.title || x.site)}</h2>
    ${x.label ? `<p>${esc(x.label)}</p>` : ''}
    ${x.url ? `<p><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url.replace(/^https?:\/\//, ''))}</a></p>` : ''}
    <p><a href="${esc(x.clip)}" target="_blank">clip.md</a> · <a href="${esc(x.src)}" target="_blank">open file</a></p>
    <div class="row"><button id="close">Close</button></div>`;
  $('close').onclick = () => $('dlg').close();
  $('dlg').showModal();
}
$('dlg').addEventListener('click', (e) => { if (e.target === $('dlg')) $('dlg').close(); });
$('dlg').addEventListener('close', () => $('vmedia').querySelector('video')?.pause());
$('shuffle').onclick = () => { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } render(); };
$('size').oninput = (e) => { document.documentElement.style.setProperty('--tile', e.target.value + 'px'); store.set('size', e.target.value); };
const size = store.get('size', '240'); $('size').value = size; document.documentElement.style.setProperty('--tile', size + 'px');
const th = store.get('theme', ''); if (th) document.documentElement.dataset.theme = th;
const mode = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const label = () => { $('theme').textContent = mode() === 'dark' ? 'Light' : 'Dark'; };
$('theme').onclick = () => { const next = mode() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); label(); };
label();
render();
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("library")
    ap.add_argument("--collection")
    a = ap.parse_args()
    lib = pathlib.Path(os.path.expanduser(a.library)).resolve()
    items = items_of(lib, a.collection)
    n_clips = len({x["clip"] for x in items})
    sub = f"{len(items)} visuals from {n_clips} clips" + (f" · {a.collection}" if a.collection else "")
    page = PAGE.replace("__SUB__", html.escape(sub)).replace("__DATA__", json.dumps(items).replace("</", "<\\/"))
    out = lib / "canvas.html"
    out.write_text(page)
    print(out)
    print(sub)


if __name__ == "__main__":
    main()
