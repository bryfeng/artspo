#!/usr/bin/env python3
"""Import someone's Artspo book into your library, so its patterns show up in your catalogue and your agent can
build with them next to your own.

Usage:  python3 import_book.py SOURCE [LIBRARY] [--as NAME]

  SOURCE     a book's address (https://sam.github.io/artbook/), its artbook.md, or a downloaded artbook.md
  LIBRARY    your artspo folder (default: ~/Downloads/artspo)
  --as NAME  the short name to file it under (default: from the book's title)

Patterns land in LIBRARY/patterns/imported/NAME/, each crediting the book it came from. Their keys are
id@NAME (soft-rise-reveal@sams-artbook), so they never collide with yours. Re-running replaces that book's
folder with the latest version; nothing else in your library changes. Works stay in the book: read them there.

Python 3.8+, standard library only.
"""
import datetime
import pathlib
import re
import shutil
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from book import parse_artbook  # noqa: E402


def fetch(source):
    if not re.match(r"^https?://", source):
        p = pathlib.Path(source).expanduser()
        if p.is_dir():
            p = p / "artbook.md"
        if not p.exists():
            sys.exit(f"No file at {p}.")
        return p.read_text(encoding="utf-8"), ""
    url = re.sub(r"(index\.html)?([?#].*)?$", "", source)
    if not url.endswith(".md"):
        url = url.rstrip("/") + "/artbook.md"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "artspo-import"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8"), url
    except Exception as e:
        sys.exit(f"Couldn't download {url} ({e}).\nDownload artbook.md yourself (open it in a browser and save it), then run:\n"
                 f"  python3 import_book.py path/to/artbook.md")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("'", "")).strip("-")[:40] or "book"


def q(v):
    return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        sys.exit(__doc__)
    name = None
    if "--as" in argv:
        i = argv.index("--as")
        name = slug(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    text, fetched = fetch(argv[0])
    lib = pathlib.Path(argv[1] if len(argv) > 1 else "~/Downloads/artspo").expanduser().resolve()
    if not lib.exists():
        sys.exit(f"No library at {lib}. Pass your artspo folder as the second argument.")
    try:
        book, pats = parse_artbook(text)
    except ValueError as e:
        sys.exit(str(e))
    if not pats:
        sys.exit("That book has no patterns to import.")
    title = book.get("title") or "An Artspo book"
    url = book.get("url") or (fetched.rsplit("/", 1)[0] + "/" if fetched else "")
    name = name or slug(title)
    dest = lib / "patterns" / "imported" / name
    marker = dest / "BOOK.md"
    if marker.exists():
        old = re.search(r"^url: (.*)$", marker.read_text(encoding="utf-8"), re.M)
        old = old.group(1).strip().strip('"') if old else ""
        if old and url and old != url:
            sys.exit(f"patterns/imported/{name} already holds a different book ({old}).\n"
                     f"Import this one under another name: --as another-name")
    if dest.exists():
        shutil.rmtree(dest)
    today = datetime.date.today().isoformat()
    counts = {"language": 0, "technique": 0}
    for p in pats:
        kind = p.get("kind") if p.get("kind") in counts else "technique"
        pid = slug(p.get("id") or p["title"])
        folder = dest / "languages" if kind == "language" else dest / "techniques" / slug(p.get("facet") or "other")
        folder.mkdir(parents=True, exist_ok=True)
        if (folder / f"{pid}.md").exists():  # a book can carry its own pattern and an imported one with the same id
            pid = f"{pid}-{slug(p.get('from_book') or 'b')}"
        # a pattern this book itself imported keeps its original credit
        src_title, src_url = p.get("from_book") or title, p.get("source") or (f"{url}#p.{pid}" if url else "")
        langs = [slug(x) for x in (p.get("languages") or "").split(",") if x.strip()]
        md = re.sub(r"\n+From the Artspo book [^\n]*\s*$", "", p["md"]).strip()
        fm = ["---", f"id: {pid}", f"kind: {kind}"]
        if kind == "technique":
            fm.append(f"facet: {slug(p.get('facet') or 'other')}")
        fm += [f"status: {p.get('status') or 'imported'}", "starred: false", f"from: {q(src_title)}"]
        if src_url:
            fm.append(f"source: {q(src_url)}")
        if langs:
            fm.append(f"languages: [{', '.join(langs)}]")
        fm += [f"imported: {today}", "---", ""]
        credit = f"From the Artspo book \"{src_title}\"" + (f": {src_url}" if src_url else "") + ". Imported " + today + "."
        body = f"# {p['title']}\n\n{md}\n\n## Source\n\n{credit}\n"
        (folder / f"{pid}.md").write_text("\n".join(fm) + body, encoding="utf-8")
        counts[kind] += 1
    marker.write_text("\n".join(["---", f"title: {q(title)}", f"url: {q(url)}", f"imported: {today}", "---", "",
                                 f"# {title}", "", "Imported with import_book.py. Re-run it to update; don't edit these files,",
                                 "make your own pattern that cites one instead.", ""]), encoding="utf-8")
    print(f"imported {counts['language']} languages and {counts['technique']} techniques from \"{title}\" → {dest}")
    print(f"  use them by key: <id>@{name}  (e.g. {slug(pats[0].get('id') or pats[0]['title'])}@{name})")
    print("  rebuild your catalogue to see them: python3 catalogue.py " + str(lib).replace(str(pathlib.Path.home()), "~"))


if __name__ == "__main__":
    main(sys.argv[1:])
