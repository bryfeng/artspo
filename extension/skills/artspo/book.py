"""The shareable book format: standalone prompts, artbook.md, and the social cover.

artbook.md is one Markdown file for people and agents. Each pattern and work sits between HTML comments
that carry its metadata, so import_book.py can split it back into pattern files:

    <!-- artspo:book title="..." url="..." built="..." -->
    <!-- artspo:pattern id="soft-rise-reveal" kind="technique" facet="motion" status="established" -->
    ### Soft rise reveal
    ...the pattern, headings shifted down two levels...
    <!-- /artspo:pattern -->

Standard library only.
"""
import re
import struct
import zlib

RULES = ("Rebuild from these measurements, never from a real site's code, text, logos or imagery. "
         "A font in <angle brackets> is a placeholder: pick a licensed face of that kind. "
         "Respect prefers-reduced-motion.")
FENCE = re.compile(r"^\s*(```|~~~)")
REL_LINK = re.compile(r"\[([^\]]+)\]\((?!https?:|mailto:|#)[^)]*\)")


# ---------------------------------------------------------------- markdown that travels
def shift_headings(md, by):
    """Move every Markdown heading by `by` levels (negative promotes), leaving code blocks alone."""
    out, fenced = [], False
    for line in md.splitlines():
        if FENCE.match(line):
            fenced = not fenced
        elif not fenced:
            m = re.match(r"^(#{1,6}) ", line)
            if m:
                line = "#" * max(1, min(6, len(m.group(1)) + by)) + line[len(m.group(1)):]
        out.append(line)
    return "\n".join(out)


def drop_section(md, name):
    return re.sub(r"^## " + re.escape(name) + r"\s*$.*?(?=^## |\Z)", "", md, flags=re.M | re.S)


def portable(body):
    """A pattern's Markdown with everything that only makes sense inside a library taken out:
    the title (the caller adds its own), Seen in / Part of lines, the Evidence section, and links to local files."""
    md = re.sub(r"^# .+\n?", "", body.strip(), count=1, flags=re.M)
    md = re.sub(r"^\*\*(Seen in|Part of)[^\n]*\n?", "", md, flags=re.M)
    md = drop_section(drop_section(md, "Evidence"), "Source")  # an imported pattern's Source is rebuilt from its metadata
    md = REL_LINK.sub(r"\1", md)
    md = re.sub(r"^_A live, generic demo[^\n]*_$", "_A generic demo of the move, for reference: HTML and CSS, no scripts._", md, flags=re.M)
    md = md.replace("from the measurements below", "from measurements")
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def credits(p):
    """Names of the sites a pattern was measured on, in order, without repeats."""
    seen = []
    for e in p.get("proof") or []:
        if e["name"] not in seen:
            seen.append(e["name"])
    return seen


def book_ref(book, p=None):
    if p and p.get("from_book"):
        return f'the Artspo book "{p["from_book"]}"' + (f' ({p["source"]})' if p.get("source") else "")
    if book.get("title"):
        return f'the Artspo book "{book["title"]}"' + (f' ({book["url"]})' if book.get("url") else "")
    return "an Artspo library"


def pattern_prompt(p, book):
    kind = "design language" if p["type"] == "language" else f'{p["facet"] or "design"} technique'
    out = [f'Use the {kind} "{p["title"]}" from {book_ref(book, p)}.', "", p["md"]]
    names = credits(p)
    if names:
        out += ["", "Measured on: " + ", ".join(names) + "."]
    if p["type"] == "language" and book.get("url"):
        out += ["", f'Its techniques are written up in full at {book["url"]}artbook.md']
    out += ["", "Rules: " + RULES]
    return "\n".join(out).strip() + "\n"


def work_prompt(w, patterns, book):
    """A prompt to make something in the spirit of a work: its brief and reasoning, and the
    tokens or recipe of each pattern it was made from, so it works without the book."""
    by_key = {p["key"]: p for p in patterns}
    out = [f'Make a {w.get("kind") or "piece"} in the spirit of "{w["title"]}" from {book_ref(book)}. '
           "Use the same moves with your own content; don't copy it."]
    for label, text in (("", w.get("summary")), ("## Brief", w.get("brief")), ("## Made from", w.get("made_from")),
                        ("## Left out", w.get("left_out"))):
        if text:
            out += ["", label, REL_LINK.sub(r"\1", text).strip()] if label else ["", text.strip()]
    used = [by_key[k] for k in w.get("patterns") or [] if k in by_key]
    if used:
        out += ["", "## The patterns"]
        for p in used:
            out += ["", f'### {p["title"]} ({p["type"]}{" · " + p["facet"] if p.get("facet") else ""})', p["summary"]]
            for code in p.get("recipe") or []:
                out += ["```css" if re.search(r"[{};]", code) else "```", code, "```"]
    for name, text in (w.get("texts") or {}).items():
        if not name.endswith(".md") and len(text) < 8000:
            out += ["", f"## {name}", "```" + name.rsplit(".", 1)[-1], text.rstrip(), "```"]
    out += ["", "Rules: " + RULES]
    return "\n".join(out).strip() + "\n"


# ---------------------------------------------------------------- artbook.md
def attrs(d):
    return " ".join(f'{k}="{str(v).replace(chr(34), chr(39))}"' for k, v in d.items() if v not in (None, "", []))


def artbook(book, patterns, works):
    langs = [p for p in patterns if p["type"] == "language"]
    techs = [p for p in patterns if p["type"] == "technique"]
    title = book.get("title") or "An Artspo book"
    n = lambda k, w: f"{k} {w}{'' if k == 1 else 's'}"
    out = [f"<!-- artspo:book {attrs(dict(title=title, url=book.get('url'), built=book.get('built'), format='1'))} -->",
           f"# {title}", "",
           f"An Artspo book: {n(len(langs), 'design language')}, {n(len(techs), 'technique')} and {n(len(works), 'work')}, "
           "rebuilt from measurements of real websites. Every recipe is a generic reconstruction, not a site's code.", "",
           "**For agents.** Each pattern below stands on its own: take one section to use one move, or read the whole book "
           "as a style reference. Follow the rules at the end. To add this book to an Artspo library, run the artspo "
           f"skill's importer: `python3 import_book.py {book['url'] + 'artbook.md' if book.get('url') else 'artbook.md'}`."]
    if book.get("brief"):
        out += ["", "## Brief", "", book["brief"].strip()]
    out += ["", "## Contents", ""]
    if langs:
        out.append("- Languages: " + ", ".join(p["title"] for p in langs))
    for facet in sorted({p["facet"] or "other" for p in techs}):
        out.append(f"- Techniques, {facet}: " + ", ".join(p["title"] for p in techs if (p["facet"] or "other") == facet))
    if works:
        out.append("- Works: " + ", ".join(w["title"] for w in works))
    for head, group in (("Languages", langs), ("Techniques", techs)):
        if not group:
            continue
        out += ["", f"## {head}"]
        for p in group:
            meta = dict(id=p["id_raw"], kind=p["type"], facet=p.get("facet"), status=p.get("status"),
                        languages=",".join(p.get("languages_raw") or []), from_book=p.get("from_book"), source=p.get("source"))
            body = shift_headings(p["md"], 2)
            names = credits(p)
            out += ["", f"<!-- artspo:pattern {attrs(meta)} -->", f"### {p['title']}", "", body]
            if names:
                out += ["", "Measured on: " + ", ".join(names) + "."]
            if p.get("from_book"):
                out += ["", f"From {book_ref(book, p)}."]
            out.append("<!-- /artspo:pattern -->")
    if works:
        out += ["", "## Works", "", "What was made from these patterns, with the reasoning, so you can make your own."]
        for w in works:
            body = work_prompt(w, patterns, book).split("\n", 1)[1]  # drop the "Make a…" line; the heading says it
            body = shift_headings(body.replace("Rules: " + RULES, "").strip(), 2)
            out += ["", f"<!-- artspo:work {attrs(dict(id=w['key'], kind=w.get('kind')))} -->", f"### {w['title']}", "", body,
                    "<!-- /artspo:work -->"]
    out += ["", "## Rules", "", RULES, "", "_Made with Artspo: https://github.com/bryfeng/artspo_"]
    return "\n".join(out).strip() + "\n"


BLOCK = re.compile(r"<!-- artspo:(pattern|work) (.*?) -->\n(.*?)<!-- /artspo:\1 -->", re.S)
ATTR = re.compile(r'([\w-]+)="([^"]*)"')


def parse_artbook(text):
    """(book attrs, [patterns]) where each pattern is {id, kind, facet, status, languages, from_book, source, title, md}."""
    m = re.search(r"<!-- artspo:book (.*?) -->", text)
    if not m:
        raise ValueError("Not an Artspo book: no <!-- artspo:book … --> line.")
    book = dict(ATTR.findall(m.group(1)))
    pats = []
    for kind, raw, body in BLOCK.findall(text):
        if kind != "pattern":
            continue
        a = dict(ATTR.findall(raw))
        t = re.search(r"^### (.+)$", body, re.M)
        md = body[t.end():] if t else body
        pats.append(dict(a, title=t.group(1).strip() if t else a.get("id", ""), md=shift_headings(md.strip(), -2)))
    return book, pats


# ---------------------------------------------------------------- cover.png
def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def cover_png(columns, w=1200, h=630):
    """A social card: one column of paint chips per design language, from its starter-token colors.
    columns is a list of lists of #RRGGBB. Plain PNG, written without any imaging library."""
    columns = [c for c in columns if c][:6] or [["#1C2026", "#E9ECEF", "#3B6FD8", "#C33A2B"]]
    gap, pad, ground = 10, 28, (20, 22, 26)
    cw = (w - 2 * pad - gap * (len(columns) - 1)) / len(columns)
    spans = []  # per column: (x0, x1, [(y0, y1, rgb)])
    for i, col in enumerate(columns):
        x0 = round(pad + i * (cw + gap)); x1 = round(pad + i * (cw + gap) + cw)
        ch = (h - 2 * pad - gap * (len(col) - 1)) / len(col)
        spans.append((x0, x1, [(round(pad + j * (ch + gap)), round(pad + j * (ch + gap) + ch), _rgb(c)) for j, c in enumerate(col)]))
    raw = bytearray()
    blank = bytes(ground) * w
    for y in range(h):
        row = bytearray(blank)
        for x0, x1, chips in spans:
            for y0, y1, rgb in chips:
                if y0 <= y < y1:
                    row[x0 * 3:x1 * 3] = bytes(rgb) * (x1 - x0)
                    break
        raw += b"\x00" + row
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
