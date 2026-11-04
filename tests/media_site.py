"""Builds a test site that uses every kind of media Artspo saves (for tests/media.e2e.mjs). Needs Pillow and ffmpeg."""
import json, os, random, shutil, subprocess, sys, zipfile
from pathlib import Path
from PIL import Image, ImageDraw

site = Path(sys.argv[1]); shutil.rmtree(site, ignore_errors=True); site.mkdir(parents=True)

def grad(w, h, a, b, path, fmt=None, **kw):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for x in range(w):
        t = x / max(1, w - 1)
        d.line([(x, 0), (x, h)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    d.ellipse([w * .55, h * .2, w * .9, h * .8], fill=(255, 210, 90))
    im.save(site / path, fmt, **kw)

grad(1600, 900, (23, 22, 26), (58, 91, 217), "hero.jpg", quality=80)
grad(800, 500, (240, 235, 218), (243, 134, 161), "photo.jpg", quality=80)
grad(900, 600, (11, 31, 51), (188, 248, 145), "lazy.webp", "WEBP", quality=80)
grad(600, 400, (90, 90, 90), (200, 200, 200), "hover.png")
grad(1200, 630, (23, 22, 26), (255, 107, 74), "share.jpg", quality=80)
av = Image.new("RGB", (160, 160), (87, 201, 154)); ImageDraw.Draw(av).ellipse([40, 30, 120, 110], fill=(255, 255, 255)); av.save(site / "avatar.png")
tx = Image.new("RGB", (40, 40), (251, 250, 247)); ImageDraw.Draw(tx).line([(0, 40), (40, 0)], fill=(230, 227, 220), width=2); tx.save(site / "texture.png")
for n, s in (("favicon.png", 32), ("apple-touch-icon.png", 180)):
    ic = Image.new("RGB", (s, s), (23, 22, 26)); ImageDraw.Draw(ic).rounded_rectangle([s * .2, s * .2, s * .8, s * .8], radius=s * .15, fill=(255, 107, 74)); ic.save(site / n)
Image.new("RGB", (1, 1), (255, 255, 255)).save(site / "pixel.gif")

subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-t", "2",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(site / "loop.mp4")], check=True)
shutil.copy(site / "loop.mp4", site / "stream.mp4")

def lottie(name, fr=60, op=180):
    ease_out = {"x": [0.33], "y": [0]}; ease_in = {"x": [0.67], "y": [1]}
    kf = lambda t, s: {"t": t, "s": s, "o": ease_out, "i": ease_in}
    return {"v": "5.9.0", "nm": name, "fr": fr, "ip": 0, "op": op, "w": 512, "h": 512, "ddd": 0, "assets": [],
            "markers": [{"cm": "intro", "tm": 0, "dr": 60}, {"cm": "loop", "tm": 60, "dr": 120}],
            "layers": [{"ty": 4, "nm": "dot", "ip": 0, "op": op, "st": 0, "ks": {
                "p": {"a": 1, "k": [kf(0, [100, 256]), kf(90, [412, 256]), {"t": 180, "s": [100, 256]}]},
                "o": {"a": 1, "k": [{"t": 0, "s": [0], "h": 1}, kf(30, [100]), {"t": 60, "s": [100]}]},
                "s": {"a": 0, "k": [100, 100]}}, "shapes": []},
               {"ty": 4, "nm": "ring", "ip": 0, "op": op, "st": 0, "ks": {"r": {"a": 1, "k": [
                   {"t": 0, "s": [0], "o": {"x": [0.42], "y": [0]}, "i": {"x": [0.58], "y": [1]}}, {"t": 180, "s": [360]}]}}, "shapes": []}]}
(site / "anim.json").write_text(json.dumps(lottie("Hero orbit")))
with zipfile.ZipFile(site / "badge.lottie", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("manifest.json", json.dumps({"animations": [{"id": "badge"}]}))
    z.writestr("animations/badge.json", json.dumps(lottie("Badge pop", fr=30, op=45)))
(site / "api.json").write_text(json.dumps({"items": [1, 2, 3], "layers": "not lottie"}))
(site / "orb.riv").write_bytes(b"RIVE" + bytes(random.Random(1).randrange(256) for _ in range(5000)))
font = next(p for p in Path("/usr/share/fonts").rglob("*.ttf"))
shutil.copy(font, site / "brand.ttf")

icon = lambda d: f'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="{d}"/></svg>'
icons = ["M5 12h14M13 6l6 6-6 6", "M4 6h16M4 12h16M4 18h16", "M12 5v14M5 12h14", "M6 6l12 12M18 6 6 18",
         "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M4 20h16M6 16l6-12 6 12"]
data_svg = "data:image/svg+xml;utf8," + "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='16' fill='%23ff6b4a'/%3E%3C/svg%3E"
(site / "index.html").write_text(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Fieldnote · Quiet tools for careful work</title>
<meta name="description" content="A demo site for Artspo's media capture.">
<meta property="og:image" content="/share.jpg">
<link rel="icon" href="/favicon.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" as="image" href="/hover.png">
<style>
@font-face {{ font-family: Brand; src: url(/brand.ttf); }}
body {{ margin: 0; font: 16px/1.5 system-ui; color: #17161a; background: #fbfaf7 url(/texture.png) repeat; }}
header {{ display: flex; align-items: center; gap: 24px; padding: 20px 48px; }}
.icon {{ width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }}
h1 {{ font: 500 72px/1 Brand; margin: 0 48px 24px; }}
.hero {{ width: 100%; height: 640px; object-fit: cover; border-radius: 24px; display: block; }}
.photo {{ width: 480px; border-radius: 12px; filter: grayscale(1); }}
.avatar {{ width: 64px; height: 64px; border-radius: 50%; }}
video {{ width: 640px; border-radius: 16px; }}
section {{ padding: 48px; }}
</style></head><body>
<header>
  <a href="/" aria-label="Fieldnote home"><svg width="120" height="28" viewBox="0 0 120 28"><rect width="28" height="28" rx="7" fill="#17161a"/><circle cx="14" cy="14" r="6" fill="#ff6b4a"/><text x="38" y="20" font-size="16" fill="#17161a">fieldnote</text></svg></a>
  <nav style="display:flex;gap:16px">{''.join(icon(d) for d in icons)}</nav>
  <svg width="0" height="0" style="position:absolute"><symbol id="i-star" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></symbol></svg>
  <span>{''.join('<svg class="icon"><use href="#i-star"/></svg>' for _ in range(3))}</span>
</header>
<h1>Quiet tools for careful work.</h1>
<section><img class="hero" src="/hero.jpg" alt="An orange sun over a blue field"></section>
<section style="display:flex;gap:32px;align-items:center">
  <img class="photo" src="/photo.jpg" alt="Team at work">
  <img class="avatar" src="/avatar.png" alt="Sam, the founder">
  <img src="{data_svg}" width="40" height="40" alt="">
  <img src="/pixel.gif" width="1" height="1" alt="">
  <svg width="360" height="240" viewBox="0 0 360 240"><defs><linearGradient id="g"><stop offset="0" stop-color="#5b7cff"/><stop offset="1" stop-color="#57c99a"/></linearGradient></defs><path d="M20 200C80 40 200 20 340 120L300 230Z" fill="url(#g)"/><circle cx="260" cy="70" r="30" fill="#ffd25a"/></svg>
</section>
<section style="display:flex;gap:32px">
  <video src="/loop.mp4" autoplay loop muted playsinline poster="/photo.jpg"></video>
  <video src="/stream.mp4" muted playsinline preload="auto"></video>
</section>
<section><lottie-player src="/anim.json" style="display:block;width:200px;height:200px"></lottie-player></section>
<div style="height:1800px"></div>
<section><img src="/lazy.webp" loading="lazy" width="900" height="600" alt="Below the fold"></section>
<script>
fetch('/anim.json'); fetch('/api.json'); fetch('/orb.riv'); fetch('/badge.lottie');
</script>
</body></html>""")
print("site at", site, "files:", len(list(site.iterdir())))
