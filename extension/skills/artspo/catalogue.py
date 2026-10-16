#!/usr/bin/env python3
"""Build catalogue.html for an Artspo library: clips, patterns and works on one page, linked by lineage,
with a viewer that rebuilds each clip's elements from its measurements and plays each pattern's specimen.

Usage:  python3 catalogue.py [LIBRARY] [options]

  LIBRARY        the artspo folder (default: ~/Downloads/artspo)
  --out FILE     where to write the page (default: LIBRARY/catalogue.html)
  --embed        one self-contained file, images inlined (to send, or to publish as a single page)
  --site DIR     a static folder (index.html + img/ + works/) for GitHub Pages, Netlify, Cloudflare Pages…
  --public       the public edition: leaves out private and logged-in clips, your notes, site text,
                 full-page shots, filmstrips, raw clip.md and file paths. Prints what it left out.
  --with-notes   with --public: keep your notes
  --thumbnails   with --public: show each clip's screenshot (by default clips appear only as rebuilt element sheets)
  --url URL      with --site: the address the book will live at (https://you.github.io/artbook/). Gives shared
                 links a preview image; a domain that isn't github.io also gets a CNAME file for GitHub Pages
  --cover FILE   with --site: your own social card image (1200×630). Default: paint chips from your languages
  --description TEXT  with --site: the line shown under the title in link previews
  --title TEXT   name shown in the header (e.g. "Sam's Artspo")
  --collection NAME   only that collection: its brief, its clips, the works made for it, and the patterns they use

Examples
  python3 catalogue.py                                        your private catalogue, in the library
  python3 catalogue.py --public --site ~/artspo-site          public site folder to deploy
  python3 catalogue.py --public --embed --out ~/artspo.html   public single file
  python3 catalogue.py --public --site ~/launch --collection fintech-launch   share one collection
  python3 catalogue.py --public --site ~/code/artbook --url https://you.github.io/artbook/   a book for GitHub Pages

Every --site folder is a book: index.html for people, artbook.md for agents (every pattern and work as a
standalone prompt), cover.png for link previews. Anyone can import a book into their own library with
import_book.py.

Python 3.8+, standard library only. Reads files, never changes them except the output page.
The page itself is assembled from catalogue.html.in, catalogue.css and catalogue.js next to this script.
"""
import base64
import datetime
import io
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from book import artbook, cover_png, pattern_prompt, portable, work_prompt  # noqa: E402
RESERVED = {"patterns", "reports", "works", "_generated", "skills", "icons", "inject", "lib", "popup", "offscreen", "node_modules"}


# ---------------------------------------------------------------- markdown helpers
def frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    head, body = text[3:end], text[end + 4:]
    data, last = {}, None
    for raw in head.splitlines():
        if not raw.strip():
            continue
        m = re.match(r"^\s+-\s+(.*)$", raw)
        if m and last:
            if not isinstance(data.get(last), list):
                data[last] = []
            data[last].append(scalar(m.group(1)))
            continue
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", raw)
        if not m:
            continue
        last = m.group(1)
        data[last] = value(m.group(2))
    return data, body


def strip_comment(v):
    return v if v[:1] in "\"'" else re.sub(r"\s+#.*$", "", v).strip()


def scalar(v):
    v = strip_comment(v.strip())
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1].replace('\\"', '"')
    if v in ("true", "false"):
        return v == "true"
    return v


def value(v):
    v = strip_comment(v.strip())
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [scalar(x) for x in inner.split(",") if x.strip()] if inner else []
    return "" if v == "" else scalar(v)


def section(body, name):
    m = re.search(r"^## " + re.escape(name) + r"\s*$(.*?)(?=^## |\Z)", body, re.M | re.S)
    return m.group(1).strip() if m else ""


def sub(text, label):
    m = re.search(r"^\*\*" + re.escape(label) + r"\*\*[^\n]*$(.*?)(?=^\*\*|\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


def bullets(text):
    return [l[2:].strip() for l in text.splitlines() if l.startswith("- ")]


def code_blocks(text, lang=None):
    return [c for l, c in re.findall(r"```(\w*)\n(.*?)\n```", text, re.S) if lang is None or l == lang]


def first_para(body):
    after = body.split("\n# ", 1)[-1].split("\n", 1)[-1] if "\n# " in "\n" + body else body
    for block in re.split(r"\n\s*\n", after.strip()):
        b = block.strip()
        if b and not b.startswith(("#", "**Seen", "**Part", "```", "|", "- ")):
            return re.sub(r"[_*`]", "", b).strip()
    return ""


def title_of(body):
    m = re.search(r"^# (.+)$", body, re.M)
    return m.group(1).strip() if m else ""


def hexes(text, limit=6):
    out = []
    for h in re.findall(r"#[0-9A-Fa-f]{6}\b", text):
        if h.upper() not in out:
            out.append(h.upper())
    return out[:limit]


def key_of(folder):
    return str(folder).rstrip("/").split("/")[-1]


def color(s):
    """'#FFFFFF @55%' → '#FFFFFF8C'; lab()/color()/rgba() pass through."""
    s = s.strip()
    m = re.match(r"^(#[0-9A-Fa-f]{6})\s*@(\d+)%$", s)
    return m.group(1) + "%02X" % round(int(m.group(2)) * 2.55) if m else s


def colors_in(s):
    return re.sub(r"#[0-9A-Fa-f]{6}\s*@\d+%", lambda m: color(m.group(0)), s)


# ---------------------------------------------------------------- clip element sheet
MECH = re.compile(r": (?=CSS transition|CSS animation|element\.animate|`[\w-]+`|gsap|[a-zA-Z-]+ -?[\d.]+[a-z%]*→)")
EASE = re.compile(r"(cubic-bezier\([^)]*\)|linear\([^)]*\)|steps\([^)]*\)|ease-in-out|ease-in|ease-out|ease|linear)")


def parse_motion(line, group):
    m = MECH.search(line)
    if not m or "∅" in line:
        return None
    label, rest = line[:m.start()], line[m.end():]
    cnt = re.match(r"(\d+)× ", label)
    d = dict(group=group, n=int(cnt.group(1)) if cnt else 1, label=re.sub(r"^\d+× ", "", label)[:90], raw=line)
    when = re.search(r"(at scrollY≈\d+|between scrollY [\d]+–[\d]+)", rest)
    d["when"] = when.group(1) if when else ""
    d["at"] = int(re.search(r"(\d+)", when.group(1)).group(1)) if when else 0
    stg = re.search(r"~(\d+)ms stagger", rest)
    d["stagger"] = int(stg.group(1)) if stg else 0
    dl = re.search(r"(\d+)ms delay", rest)
    d["delay"] = int(dl.group(1)) if dl else 0
    d["infinite"] = group == "loop" or "infinite" in rest
    tail = rest
    if rest.startswith("element.animate"):
        d["kind"] = "waapi"
        i = min(x for x in (rest.find("{"), rest.find("[")) if x >= 0)
        try:
            kf, end = json.JSONDecoder().raw_decode(rest, i)
            d["kf"], tail = kf, rest[end:]
        except ValueError:
            return None
    elif rest.startswith("CSS transition"):
        d["kind"] = "transition"
        d["props"] = re.findall(r"`([\w-]+)`", re.split(r"\d+ms", rest, maxsplit=1)[0])
    elif rest.startswith("CSS animation") or rest.startswith("`"):
        d["kind"] = "animation"
        d["name"] = re.search(r"`([\w-]+)`", rest).group(1)
    elif "(JS-driven" in rest:
        d["kind"] = "sampled"
        d["pairs"] = [list(p) for p in re.findall(r"([a-zA-Z-]+) (-?[\d.]+[a-z%]*)→(-?[\d.]+[a-z%]*)", rest)]
    else:
        d["kind"] = "other"
    dur = re.search(r"~?(\d+)ms(?! delay| stagger)", tail)
    d["ms"] = int(dur.group(1)) if dur else 0
    e = EASE.search(tail)
    d["ease"] = e.group(1) if e else "ease"
    en = re.search(r"\) \(([\w-]+)\)", tail)
    d["easeName"] = en.group(1) if en else ""
    d["approx"] = d["kind"] in ("sampled", "transition") or (d["kind"] == "waapi" and isinstance(d.get("kf"), list) and len(d["kf"]) == 1)
    if d["ms"] < 50 and not d["infinite"]:
        return None
    return d


def element_sheet(body):
    pal = section(body, "Palette")
    def shares(block):
        out = []
        for l in bullets(block):
            m = re.match(r"(.+?) — ([\d.]+)%", l)
            if m:
                c = m.group(1)
                out.append(dict(c=None if c.startswith("imagery") else color(c), label=c, pct=float(m.group(2))))
        return out
    accents = []
    for l in bullets(sub(pal, "Accent candidates")):
        m = re.match(r'(.+?) — e\.g\. "(.*)"', l)
        if m:
            accents.append(dict(c=color(m.group(1)), eg=m.group(2)))
    theme = re.search(r"theme-color meta: (\S+)", pal)

    ty = section(body, "Typography")
    disp = None
    m = re.search(r'^- Display: "([^"]+)" ([\d.]+)px/(\d+)(.*)$', ty, re.M)
    if m:
        ls = re.search(r"\((-?[\d.]+)em\)", m.group(4))
        lh = re.search(r"line-height [\d.]+px \(([\d.]+)\)", m.group(4))
        sample = re.search(r'— "(.*)"$', m.group(4))
        disp = dict(family=m.group(1), px=float(m.group(2)), weight=int(m.group(3)), ls=float(ls.group(1)) if ls else 0,
                    lh=float(lh.group(1)) if lh else 1.1, upper="uppercase" in m.group(4), sample=sample.group(1) if sample else "")
    bm = re.search(r'^- Body: "([^"]+)" ([\d.]+)px, line-height ([\d.]+)px', ty, re.M)
    fams = []
    fm = re.search(r"Families by text share: (.*)", ty)
    if fm:
        for part in fm.group(1).split(", "):
            mm = re.match(r"(.+) (\d+)%$", part.strip())
            if mm:
                fams.append(dict(name=mm.group(1), pct=int(mm.group(2))))
    scale = [dict(px=float(a), weight=int(b), family=c, sample=s) for a, b, c, s in
             re.findall(r'^\s+- ([\d.]+)px (\d+) (.+?) — "(.*)"$', ty, re.M)]
    webfonts = re.search(r"Loaded webfonts: (.*)", ty)

    sh = section(body, "Shape & spacing")
    def counted(line_name):
        lm = re.search(r"^- " + line_name + r": (.*)$", sh, re.M)
        if not lm or lm.group(1).startswith("none"):
            return []
        return [dict(v=colors_in(v.strip()), n=int(n), eg=(eg or "").strip()) for v, n, eg in
                re.findall(r"(?:^|; )`?(.+?)`? \((\d+)×(?: e\.g\. ([^)]*))?\)", lm.group(1))]
    radii, shadows, borders = counted("Radii"), counted("Shadows"), counted("Borders")
    spacing = re.search(r"^- Spacing: (.*)$", sh, re.M)

    buttons = []
    for l in bullets(section(body, "Buttons")):
        g = lambda p: (re.search(p, l) or [None, None])[1]
        buttons.append(dict(
            filled=l.startswith("filled"), fill=color(g(r"^filled (.+?), text") or "transparent"), text=color(g(r"text (.+?), radius") or "inherit"),
            radius=g(r"radius (.+?), padding") or "0", padding=g(r"padding (.+?), [\d.]+px/") or "0",
            size=float(g(r"([\d.]+)px/\d+") or 14), weight=int(g(r"[\d.]+px/(\d+)") or 400),
            border=colors_in(g(r"border (\d+px .+?), ~") or ""), height=int(g(r"~(\d+)px tall") or 0),
            labels=re.findall(r'"([^"]*)"', l.split(" — ", 1)[1] if " — " in l else "")[:3]))

    mo = section(body, "Motion")
    libs = re.search(r"\*\*Libraries:\*\* (.*)", mo)
    keyframes = {name: css for css, name in re.findall(r"```css\n(@keyframes ([\w-]+) .*?)\n```", mo, re.S)}
    motion = []
    for group, label in (("load", "On load"), ("scroll", "On scroll"), ("loop", "Looping")):
        seen = set()
        for l in bullets(sub(mo, label)):
            d = parse_motion(l, group)
            if not d:
                continue
            k = (d["label"][:24], d["kind"], d["ms"], d["ease"], d["delay"], json.dumps(d.get("kf")), d.get("name"), str(d.get("props")))
            if k in seen:
                continue
            seen.add(k)
            motion.append(d)
    declared = []
    for l in bullets(sub(mo, "Declared transitions")):
        m = re.match(r"^(.+?) — (\d+)ms (.+?) — (\d+) elements?(?: \((.*)\))?$", l)
        if m:
            e = EASE.search(m.group(3))
            declared.append(dict(props=m.group(1), ms=int(m.group(2)), ease=e.group(1) if e else "ease",
                                 easeName=(re.search(r"\(([\w-]+)\)$", m.group(3)) or [None, ""])[1], n=int(m.group(4)), eg=(m.group(5) or "")[:80]))
    return dict(
        surfaces=shares(sub(pal, "Surfaces")), text=shares(sub(pal, "Text")), accents=accents, theme=theme.group(1) if theme else "",
        display=disp, body=dict(family=bm.group(1), px=float(bm.group(2)), lh=float(bm.group(3))) if bm else None,
        families=fams, scale=scale, webfonts=webfonts.group(1) if webfonts else "",
        radii=radii, shadows=shadows, borders=borders, spacing=spacing.group(1) if spacing else "",
        buttons=buttons, libs=libs.group(1) if libs else "", keyframes=keyframes, motion=motion, declared=declared,
        gaps=bullets(section(body, "Not captured")))


# ---------------------------------------------------------------- library
def frames_of(d, body):
    m = re.search(r"filmstrip/(\d+)[–-](\d+)\.jpg", body)
    if m:
        names = [f"{i:02d}.jpg" for i in range(int(m.group(1)), int(m.group(2)) + 1)]
    else:
        names = sorted(p.name for p in (d / "filmstrip").glob("*.jpg")) if (d / "filmstrip").exists() else []
    return [n for n in names if (d / "filmstrip" / n).exists()]


def read_clips(lib):
    clips, superseded = [], 0
    for coll in sorted(p for p in lib.iterdir() if p.is_dir() and p.name not in RESERVED and not p.name.startswith(".")):
        for d in sorted(p for p in coll.iterdir() if p.is_dir()):
            f = d / "clip.md"
            if not f.exists():
                continue
            text = f.read_text(encoding="utf-8", errors="replace")
            fm, body = frontmatter(text)
            if fm.get("status") == "superseded":
                superseded += 1
                continue
            note = section(body, "Note")
            note_text = "" if (not note or note.startswith("_(no note)")) else note.split("\n> ", 1)[0].strip()
            quote = re.search(r"^> (.+)$", note, re.M)
            url = fm.get("url", "")
            base = f"{coll.name}/{d.name}"
            sheet = element_sheet(body)
            clips.append(dict(
                type="clip", key=d.name, folder=base, collection=fm.get("collection", coll.name),
                title=fm.get("title", d.name), url=url, host=re.sub(r"^https?://(www\.)?", "", url).rstrip("/"),
                clipped=str(fm.get("clipped", ""))[:10], inspected=str(fm.get("inspected", ""))[:16].replace("T", " "),
                status=fm.get("status", ""), tags=fm.get("tags") or [], libs=fm.get("libraries") or [], note=note_text,
                tagline=quote.group(1).strip() if quote else "", swatches=hexes(section(body, "Palette").split("**Text**")[0], 5),
                display=sheet["display"]["family"] if sheet["display"] else "",
                img=next((f"{base}/{n}" for n in ("seen.jpg", "filmstrip/01.jpg", "full.jpg") if (d / n).exists()), ""),
                full=f"{base}/full.jpg" if (d / "full.jpg").exists() else "",
                frames=[f"{base}/filmstrip/{n}" for n in frames_of(d, body)],
                sheet=sheet, record=text, path=f"{base}/clip.md",
                private=fm.get("private") is True, public=fm.get("public") is True))
    return clips, superseded


def read_collections(lib, clips):
    out = []
    names = sorted({c["collection"] for c in clips} | {p.name for p in lib.iterdir() if (p / "collection.md").exists()})
    for name in names:
        f = lib / name / "collection.md"
        fm, body = frontmatter(f.read_text(encoding="utf-8", errors="replace")) if f.exists() else ({}, "")
        brief = section(body, "Brief")
        links = []
        for l in bullets(section(body, "Links")):
            m = re.match(r"(\S+)(?: — (.*?))?(?: \(added ([\d-]+)\))?$", l)
            if m:
                links.append(dict(url=m.group(1), why=m.group(2) or "", added=m.group(3) or ""))
        out.append(dict(key=name, title=fm.get("title") or name, brief="" if brief.startswith("_(") else brief,
                        links=links, clips=sum(1 for c in clips if c["collection"] == name)))
    return out


def scope_to(collection, clips, patterns, works, collections):
    """Keep one collection: its clips, the works made for it or from its clips, and the patterns they touch."""
    if collection not in {c["key"] for c in collections}:
        sys.exit(f"No collection named {collection}. Collections: {', '.join(c['key'] for c in collections)}")
    clips = [c for c in clips if c["collection"] == collection]
    keys = {c["key"] for c in clips}
    works = [w for w in works if w.get("collection") == collection or keys & set(w["clips"])]
    used = {p for w in works for p in w["patterns"]}
    patterns = [p for p in patterns if p["key"] in used or keys & set(p["evidence"] + p["partial"])]
    return clips, patterns, works, [c for c in collections if c["key"] == collection]


def read_patterns(lib):
    """Your patterns, then any imported from other people's books (patterns/imported/<book>/…).
    An imported pattern's key is id@book, so it never collides with one of yours."""
    out = []
    root = lib / "patterns"
    if not root.exists():
        return out
    files = [(f, "") for f in sorted(root.glob("languages/*.md")) + sorted(root.glob("techniques/*/*.md"))]
    for b in sorted(p for p in (root / "imported").glob("*") if p.is_dir()):
        files += [(f, b.name) for f in sorted(b.glob("languages/*.md")) + sorted(b.glob("techniques/*/*.md"))]
    for f, book in files:
        fm, body = frontmatter(f.read_text(encoding="utf-8", errors="replace"))
        kind = fm.get("kind") or ("language" if f.parent.name == "languages" else "technique")
        tag = (lambda k: f"{k}@{book}") if book else (lambda k: k)
        langs = fm.get("languages") or []
        feel = re.search(r"^_(.+)_$", body, re.M)
        evidence = []
        for l in bullets(section(body, "Evidence")):
            m = re.match(r"\*\*(.+?)\*\*: (.*)$", l)
            if not m:
                continue
            lk = re.search(r"\(\[([^\]]+)\]\(([^)]+)\)\)\s*$", m.group(2))
            q = m.group(2)[:lk.start()].strip() if lk else m.group(2)
            q = re.sub(r"^``\s?|\s?``$", "", q.strip()).strip("`").strip()
            src = lk.group(1) if lk else ""
            clip_key = next((p for p in (lk.group(2).split("/") if lk else []) if re.match(r"\d{4}-\d\d-\d\d_", p)), "")
            evidence.append(dict(name=m.group(1), quote=q, source="clip.md" if src not in ("seen.jpg", "full.jpg") else src, clip=clip_key))
        spec = code_blocks(section(body, "Specimen"), "html")
        out.append(dict(
            type=kind, key=tag(fm.get("id", f.stem)), id_raw=fm.get("id", f.stem), title=title_of(body) or f.stem,
            facet=fm.get("facet", "") or (f.parent.name if kind == "technique" else ""),
            status=fm.get("status", ""), starred=bool(fm.get("starred")),
            evidence=[key_of(e) for e in fm.get("evidence") or []], partial=[key_of(e) for e in fm.get("partial") or []],
            languages=[tag(l) for l in langs], languages_raw=langs, updated=str(fm.get("updated") or fm.get("imported") or ""),
            from_book=fm.get("from", "") if book else "", source=fm.get("source", "") if book else "", md=portable(body),
            summary=(feel.group(1) if (kind == "language" and feel) else first_para(body)),
            swatches=hexes(section(body, "Starter tokens"), 6) if kind == "language" else [],
            specimen=spec[0] if spec else "",
            recipe=code_blocks(section(body, "Recipe")) + code_blocks(section(body, "Starter tokens")),
            use=section(body, "Use when"), avoid=section(body, "Avoid when"), proof=evidence,
            path=str(f.relative_to(lib))))
    return out


def read_works(lib):
    out = []
    for base in ("works", "_generated"):
        root = lib / base
        if not root.exists():
            continue
        for d in sorted((p for p in root.iterdir() if p.is_dir()), reverse=True):
            f = d / "work.md"
            fm, body = frontmatter(f.read_text(encoding="utf-8", errors="replace")) if f.exists() else ({}, "")
            prev = fm.get("preview") or next((n for n in ("preview.jpg", "preview.png", "preview.webp") if (d / n).exists()), "")
            verdict = section(body, "Verdict")
            files = fm.get("files") or sorted(p.name for p in d.iterdir() if p.is_file() and p.name != "work.md")
            texts = {}
            for n in files:
                p = d / n
                if p.exists() and p.suffix in (".md", ".css", ".txt", ".json") and p.stat().st_size < 40000:
                    texts[n] = p.read_text(encoding="utf-8", errors="replace")
            html = next((n for n in files if n.endswith(".html") and (d / n).exists()), "")
            out.append(dict(
                type="work", key=d.name, collection=fm.get("collection", ""), title=fm.get("title") or title_of(body) or d.name, kind=fm.get("kind", "" if f.exists() else "uncatalogued"),
                status=fm.get("status", "draft" if f.exists() else "uncatalogued"), starred=bool(fm.get("starred")),
                made_by=fm.get("made_by", ""), made=str(fm.get("made", d.name[:10])),
                patterns=fm.get("patterns") or [], clips=[key_of(c) for c in fm.get("clips") or []],
                files=files, texts=texts, html=f"{base}/{d.name}/{html}" if html else "",
                summary=first_para(body), verdict="" if verdict.startswith("_") else verdict, brief=section(body, "Brief"),
                made_from=section(body, "Made from"), left_out=section(body, "Left out"),
                img=f"{base}/{d.name}/{prev}" if prev and (d / prev).exists() else "", dir=f"{base}/{d.name}",
                path=f"{base}/{d.name}/work.md" if f.exists() else f"{base}/{d.name}/"))
    return out


def image_bytes(lib, rel, width=720, max_h=None):
    """JPEG bytes, downscaled when Pillow is available; the original file otherwise."""
    p = lib / rel
    data = p.read_bytes()
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)))
        if max_h:
            im = im.crop((0, 0, im.width, min(im.height, max_h)))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=74, optimize=True)
        return buf.getvalue(), ".jpg"
    except Exception:
        return data, p.suffix or ".jpg"


def embed_image(lib, rel, width=720, max_h=None):
    data, ext = image_bytes(lib, rel, width, max_h)
    mime = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
    return f"data:{mime};base64," + base64.b64encode(data).decode()


# ---------------------------------------------------------------- public edition
LOGGED_IN = re.compile(r"^(app|dashboard|console|admin|portal|account|my|studio)\.|/(workspaces?|dashboard|settings|account|admin|inbox|org|projects?/\w)", re.I)
GENERIC = "Sphinx of black quartz, judge my vow"
QUOTED = re.compile(r'\s*"[^"]*"')


def public_edition(clips, patterns, works, with_notes=False, thumbnails=False):
    """Drop what shouldn't leave your machine. Returns (clips, removed) — removed is [(title, reason)]."""
    keep, removed = [], []
    for c in clips:
        host = re.sub(r"^https?://", "", c["url"])
        if c["private"]:
            removed.append((c["title"], "marked private: true"))
            continue
        if LOGGED_IN.search(host) and not c["public"]:
            removed.append((c["title"], "looks like a logged-in page (set public: true in its clip.md to include it)"))
            continue
        s = c["sheet"]
        if s["display"]:
            s["display"]["sample"] = GENERIC
        for x in s["scale"]:
            x["sample"] = GENERIC
        for m in s["motion"]:
            m["label"] = QUOTED.sub("", m["label"]).strip(", ") or "element"
            m["raw"] = ""
        c.update(record="", full="", frames=[], tagline="", path="", tags=[])
        if not thumbnails:  # by default a public book shows no one else's pixels: clips appear as rebuilt element sheets
            c["img"] = ""
        if not with_notes:
            c["note"] = ""
        keep.append(c)
    for it in patterns + works:
        it["path"] = ""
    for w in works:
        w["texts"] = {n: t for n, t in w["texts"].items() if not n.endswith(".md")}  # rationale and notes stay home
    return keep, removed


def write_site(lib, site, clips, works):
    """Static folder: index.html + images, ready for any static host."""
    import shutil
    (site / "img").mkdir(parents=True, exist_ok=True)
    for c in clips:
        if c["img"]:
            data, ext = image_bytes(lib, c["img"], 960, 600)
            name = f"img/{c['key']}{ext}"
            (site / name).write_bytes(data)
            c["img"] = name
        for i, fr in enumerate(c["frames"]):
            data, ext = image_bytes(lib, fr, 960)
            name = f"img/{c['key']}-f{i + 1:02d}{ext}"
            (site / name).write_bytes(data)
            c["frames"][i] = name
        if c["full"]:
            data, ext = image_bytes(lib, c["full"], 960)
            name = f"img/{c['key']}-full{ext}"
            (site / name).write_bytes(data)
            c["full"] = name
    for w in works:
        src = lib / w["dir"]
        dst = site / "works" / w["key"]
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("*.md"))
        rebase = lambda p: f"works/{w['key']}/{p.split('/', 2)[2]}" if p else p
        w["img"], w["html"] = rebase(w["img"]), rebase(w["html"])


def head_tags(title, description, url, cover):
    """<title> plus the tags that make a shared link preview well (Open Graph, X) and point agents at artbook.md."""
    esc = lambda t: str(t).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    img = (url + cover) if url and cover else cover
    tags = [f"<title>{esc(title)}</title>",
            f'<meta name="description" content="{esc(description)}">',
            f'<meta property="og:type" content="website">',
            f'<meta property="og:title" content="{esc(title)}">',
            f'<meta property="og:description" content="{esc(description)}">',
            f'<link rel="alternate" type="text/markdown" href="artbook.md" title="This book as Markdown, for agents">']
    if url:
        tags.append(f'<meta property="og:url" content="{esc(url)}">')
    if img:
        tags += [f'<meta property="og:image" content="{esc(img)}">', '<meta property="og:image:width" content="1200">',
                 '<meta property="og:image:height" content="630">', '<meta name="twitter:card" content="summary_large_image">']
    return "\n".join(tags)


def main(argv):
    opts = {"--out": None, "--site": None, "--title": None, "--collection": None, "--url": None, "--cover": None, "--description": None}
    flags, args, i = set(), [], 0
    while i < len(argv):
        a = argv[i]
        if a in opts:
            opts[a] = argv[i + 1]
            i += 2
            continue
        (flags.add if a.startswith("--") else args.append)(a)
        i += 1
    unknown = flags - {"--embed", "--public", "--with-notes", "--thumbnails"}
    if unknown:
        sys.exit(f"Unknown option {', '.join(sorted(unknown))}. See: python3 catalogue.py --help" if "--help" not in flags else __doc__)
    lib = pathlib.Path(args[0] if args else "~/Downloads/artspo").expanduser().resolve()
    if not lib.exists():
        sys.exit(f"No library at {lib}. Clip something with the Artspo extension first, or pass the folder.")
    embed, public = "--embed" in flags, "--public" in flags
    site = pathlib.Path(opts["--site"]).expanduser().resolve() if opts["--site"] else None
    if embed and site:
        sys.exit("Use --embed (one file) or --site DIR (a folder), not both.")
    url = opts["--url"]
    if url:
        if not re.match(r"^https?://[^/\s]+", url):
            sys.exit("--url must be the address the site will live at, e.g. https://you.github.io/artbook/")
        url = url.rstrip("/") + "/"
        if not site:
            sys.exit("--url only applies with --site DIR.")

    clips, superseded = read_clips(lib)
    patterns = read_patterns(lib)
    works = read_works(lib)
    collections = read_collections(lib, clips)
    if opts["--collection"]:
        clips, patterns, works, collections = scope_to(opts["--collection"], clips, patterns, works, collections)
        if not opts["--title"]:
            opts["--title"] = collections[0]["title"]
    removed = []
    if public:
        clips, removed = public_edition(clips, patterns, works, "--with-notes" in flags, "--thumbnails" in flags)
    built = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    book = dict(title=opts["--title"] or "", url=url or "", built=built,
                brief=collections[0]["brief"] if opts["--collection"] and collections else "")
    for p in patterns:
        p["prompt"] = pattern_prompt(p, book)
    for w in works:
        w["prompt"] = work_prompt(w, patterns, book)
    langs = [p for p in patterns if p["type"] == "language"]
    description = opts["--description"] or book["brief"] or (
        f"{len(langs)} design language{'s' * (len(langs) != 1)}, {len(patterns) - len(langs)} techniques and "
        f"{len(works)} work{'s' * (len(works) != 1)}, measured from real websites, each with a prompt you can copy. Made with Artspo.")
    head = "<title>Artspo Catalogue</title>"
    if site:
        site.mkdir(parents=True, exist_ok=True)
        write_site(lib, site, clips, works)
        out = site / "index.html"
        (site / "artbook.md").write_text(artbook(book, patterns, works), encoding="utf-8")
        if opts["--cover"]:
            src = pathlib.Path(opts["--cover"]).expanduser()
            cover = "cover" + (src.suffix.lower() or ".png")
            (site / cover).write_bytes(src.read_bytes())
        else:
            cover = "cover.png"
            (site / cover).write_bytes(cover_png([p["swatches"] for p in langs]))
        (site / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: serve the folder as it is
        host = re.sub(r"^https?://([^/:]+).*$", r"\1", url) if url else ""
        if host and not host.endswith(".github.io"):
            (site / "CNAME").write_text(host + "\n", encoding="utf-8")  # GitHub Pages: your own domain
        head = head_tags(book["title"] or "An Artspo book", description, url, cover)
    else:
        out = pathlib.Path(opts["--out"]).expanduser() if opts["--out"] else lib / "catalogue.html"
        if embed:
            for it in clips:
                it["img"] = embed_image(lib, it["img"], 960, 600) if it["img"] else ""
                it["full"] = embed_image(lib, it["full"], 720) if it["full"] else ""
                it["frames"] = [embed_image(lib, fr, 720) for fr in it["frames"]]
            for it in works:
                it["img"] = embed_image(lib, it["img"], 960, 600) if it["img"] else ""
                it["html"] = ""
    for p in patterns:
        p.pop("md", None)  # already in the prompt
    data = dict(
        title=opts["--title"] or "", library="" if public else str(lib).replace(str(pathlib.Path.home()), "~"),
        built=built, embedded=embed or public, public=public, book=bool(site), url=url or "",
        superseded=0 if public else superseded, clips=clips, patterns=patterns, works=works,
        collections=collections, scope=opts["--collection"] or "")
    page = ((HERE / "catalogue.html.in").read_text(encoding="utf-8")
            .replace("%%HEAD%%", head)
            .replace("%%CSS%%", (HERE / "catalogue.css").read_text(encoding="utf-8"))
            .replace("%%JS%%", (HERE / "catalogue.js").read_text(encoding="utf-8"))
            .replace("%%DATA%%", json.dumps(data, ensure_ascii=False).replace("</", "<\\/")))
    if not embed:  # a standalone file needs its own doctype; a page published as an artifact gets one from the host
        page = '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n' + page
    out.write_text(page, encoding="utf-8")
    edition = "public edition" if public else "private"
    print(f"catalogue ({edition}) → {out}  ({len(works)} works, {len(patterns)} patterns, {len(clips)} clips"
          + (f", {superseded} superseded hidden" if superseded and not public else "") + ")")
    for title, why in removed:
        print(f"  left out: {title} — {why}")
    if public:
        print("  also left out: notes" + ("" if "--with-notes" not in flags else " (kept: --with-notes)")
              + ", page text, full-page shots, filmstrips, raw clip.md, work .md files, file paths"
              + ("" if "--thumbnails" in flags else ", clip screenshots (add --thumbnails to show them)"))
    if site:
        print(f"  book: artbook.md (for agents), {cover} (social card)" + (", CNAME" if (site / "CNAME").exists() and url else ""))
        if not url:
            print("  tip: add --url https://you.github.io/<repo>/ so shared links get a preview image")


if __name__ == "__main__":
    main(sys.argv[1:])
