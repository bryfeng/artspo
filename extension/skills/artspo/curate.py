#!/usr/bin/env python3
"""Curate the media Artspo saved: an agent looks at it and sets aside what isn't visual material.

The extension already leaves out logos, icons, the nav and footer, and the people and product screens it can tell
from their labels. It can't see pictures, so unlabeled photos of people and screenshots of product UI still get in.
This script lets an agent with vision finish the job:

  python3 curate.py <library> [--collection NAME]          numbered contact sheets -> <library>/_curate/sheet-NN.jpg
  python3 curate.py <library> --drop 3 17 40-44 --why people   set those numbers aside

Setting aside moves files to <library>/_set-aside/<why>/... (nothing is deleted), drops their lines from clip.md,
and keeps each clip.md's original in _set-aside/clip-md-originals/. Needs Pillow for the sheets
(pip install pillow); SVGs are drawn when rsvg-convert or ImageMagick is installed, otherwise named.
Re-inspecting a clip saves its media again, so curate again after a re-inspection.
"""
import argparse, io, json, os, pathlib, re, shutil, subprocess, sys

SKIP = {"patterns", "reports", "works", "skills", "books"}
COLS, ROWS, CW, CH = 8, 6, 230, 170


def media_files(lib, collection=None):
    out = []
    for coll in sorted(p for p in lib.iterdir() if p.is_dir() and p.name not in SKIP and not p.name.startswith((".", "_"))):
        if collection and coll.name != collection:
            continue
        for clip in sorted(c for c in coll.iterdir() if (c / "clip.md").exists() and (c / "assets").is_dir()):
            for kind in ("img", "svg"):
                out += sorted(str(f.relative_to(lib)) for f in (clip / "assets" / kind).glob("*") if f.is_file())
    return out


def thumb(path, Image):
    if path.suffix.lower() == ".svg":
        for cmd in (["rsvg-convert", "-w", "400", str(path)], ["magick", "-background", "none", str(path), "png:-"],
                    ["convert", "-background", "none", str(path), "png:-"]):
            if shutil.which(cmd[0]):
                try:
                    png = subprocess.run(cmd, capture_output=True, timeout=20).stdout
                    return Image.open(io.BytesIO(png)) if png else None
                except Exception:
                    pass
        return None
    try:
        return Image.open(path)
    except Exception:
        return None


def sheets(lib, files):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        sys.exit("Contact sheets need Pillow: pip install pillow (or pip3 install --user pillow)")
    out = lib / "_curate"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    made = []
    per = COLS * ROWS
    for s in range(0, len(files), per):
        sheet = Image.new("RGB", (COLS * CW, ROWS * CH), "white")
        d = ImageDraw.Draw(sheet)
        for k, rel in enumerate(files[s:s + per]):
            i, x, y = s + k, (k % COLS) * CW, (k // COLS) * CH
            for cx in range(x, x + CW, 12):          # checkerboard, so white and transparent art shows
                for cy in range(y, y + CH - 18, 12):
                    if ((cx - x) // 12 + (cy - y) // 12) % 2:
                        d.rectangle([cx, cy, cx + 11, cy + 11], fill=(228, 228, 228))
            im = thumb(lib / rel, Image)
            if im:
                im = im.convert("RGBA")
                im.thumbnail((CW - 10, CH - 24))
                sheet.paste(im, (x + (CW - im.width) // 2, y + (CH - 18 - im.height) // 2), im)
            else:
                d.text((x + 8, y + 60), "(not drawn)", fill="gray")
            parts = rel.split("/")
            site = parts[1].split("_")[1] if len(parts) > 1 and "_" in parts[1] else parts[0]
            d.rectangle([x, y + CH - 18, x + CW, y + CH], fill="white")
            d.text((x + 4, y + CH - 16), f"{i} {site[:14]} {parts[-1][:14]}", fill="black")
            d.rectangle([x, y, x + CW - 1, y + CH - 1], outline=(180, 180, 180))
        p = out / f"sheet-{s // per + 1:02d}.jpg"
        sheet.save(p, quality=82)
        made.append(p)
    (out / "index.json").write_text(json.dumps(files, indent=0))
    return made


def numbers(tokens):
    got = set()
    for t in tokens:
        for part in str(t).split(","):
            if "-" in part:
                a, b = part.split("-", 1)
                got.update(range(int(a), int(b) + 1))
            elif part.strip():
                got.add(int(part))
    return sorted(got)


def drop(lib, picks, why):
    index = json.loads((lib / "_curate" / "index.json").read_text())
    gone = {}
    for i in picks:
        if i >= len(index):
            print(f"  no tile {i}", file=sys.stderr)
            continue
        rel = index[i]
        src = lib / rel
        if not src.exists():
            continue
        dst = lib / "_set-aside" / why / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        clip = "/".join(rel.split("/")[:2])
        gone.setdefault(clip, set()).add("/".join(rel.split("/")[2:]))
    for clip, paths in gone.items():
        md_path = lib / clip / "clip.md"
        md = md_path.read_text()
        keep = lib / "_set-aside" / "clip-md-originals" / clip / "clip.md"
        if not keep.exists():
            keep.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(md_path, keep)
        lines = [l for l in md.split("\n") if not (l.startswith("- `assets/") and re.match(r"- `([^`]+)`", l).group(1) in paths)]
        text = re.sub(r", poster `(assets/[^`]+)`", lambda m: "" if m.group(1) in paths else m.group(0), "\n".join(lines))
        md_path.write_text(text)
    n = sum(len(p) for p in gone.values())
    print(f"set aside {n} file{'s' * (n != 1)} in _set-aside/{why}/ from {len(gone)} clip{'s' * (len(gone) != 1)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("library")
    ap.add_argument("--collection")
    ap.add_argument("--drop", nargs="+", metavar="N", help="tile numbers from the sheets: 3 17 40-44")
    ap.add_argument("--why", default="set-aside", help="folder name under _set-aside/: people, product-ui, logos…")
    a = ap.parse_args()
    lib = pathlib.Path(os.path.expanduser(a.library)).resolve()
    if a.drop:
        drop(lib, numbers(a.drop), re.sub(r"[^a-z0-9-]+", "-", a.why.lower()).strip("-") or "set-aside")
        return
    files = media_files(lib, a.collection)
    if not files:
        print("No saved media to curate.")
        return
    for p in sheets(lib, files):
        print(p)
    print(f"{len(files)} tiles. Look at each sheet, then: python3 curate.py {a.library} --drop <numbers> --why <reason>")


if __name__ == "__main__":
    main()
