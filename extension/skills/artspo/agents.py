"""The agent catalogue: a book that coding agents can shop, item by item, without reading the whole thing.

Every --site book gets these files next to index.html (people) and artbook.md (the whole book):

    llms.txt                     what this is and where to start, in the llms.txt format
    agents/menu.json             every language, technique and clip: facets, counts, one line each, a link to each
    agents/patterns/<id>.json    one pattern in full: recipe, starter tokens, specimen, evidence, and a standalone prompt
    agents/clips/<key>.json      one measured site: palette, type, shape, buttons, motion, and a standalone prompt

An agent reads the menu, picks what fits its user's brief, and fetches only those items. Each item's `prompt`
works on its own in any AI. All of it is built from the public edition, so it carries nothing index.html doesn't.

Standard library only.
"""
import json

from book import RULES

FACETS = ("color", "type", "shape", "layout", "motion")
SKILL = "https://github.com/bryfeng/artspo"
FORMAT = "1"


def slug(key):
    return key.replace("@", "--")


def has_measurements(c):
    s = c["sheet"]
    return bool(s["surfaces"] or s["display"] or s["motion"] or s["radii"])


def _href(url):
    return lambda path: (url + path) if url else path


# ---------------------------------------------------------------- clips
def clip_sheet(c):
    """The measured design system of one site, minus anything that is the site's own words."""
    s = c["sheet"]
    drop = lambda d, *keys: {k: v for k, v in d.items() if k not in keys}
    motion = []
    for m in s["motion"]:
        x = {k: m[k] for k in ("group", "n", "label", "kind", "ms", "ease", "easeName", "delay", "stagger", "when", "infinite", "approx") if m.get(k) not in (None, "", 0, False) or k in ("ms",)}
        for k in ("kf", "props", "name", "pairs"):
            if m.get(k):
                x[k] = m[k]
        motion.append(x)
    return dict(
        palette=dict(surfaces=[drop(x, "label") for x in s["surfaces"]], text=[drop(x, "label") for x in s["text"]],
                     accents=[dict(c=a["c"]) for a in s["accents"]], theme_color=s["theme"]),
        type=dict(display=drop(s["display"], "sample") if s["display"] else None, body=s["body"], families=s["families"],
                  scale=[drop(x, "sample") for x in s["scale"]], webfonts=s["webfonts"]),
        shape=dict(radii=s["radii"], shadows=s["shadows"], borders=s["borders"], spacing=s["spacing"]),
        buttons=[drop(b, "labels") for b in s["buttons"]],
        motion=dict(libraries=s["libs"], timeline=motion, keyframes=s["keyframes"], declared_transitions=s["declared"]),
        not_captured=s["gaps"])


def _pct(xs):
    return ", ".join(f'{x["c"] or "imagery"} {x["pct"]:g}%' for x in xs)


def clip_prompt(c, book, cited):
    s = c["sheet"]
    where = f'the Artspo book "{book["title"]}"' + (f' ({book["url"]})' if book.get("url") else "") if book.get("title") else "an Artspo book"
    out = [f'Use the measured design system of {c["title"]} ({c["host"]}), from {where}, as a reference. '
           "These are measurements of the live site, not its code: rebuild the feel with your own content.", ""]
    if s["surfaces"] or s["text"]:
        out.append("## Palette")
        if s["surfaces"]:
            out.append(f"- Surfaces, by share of the page: {_pct(s['surfaces'])}")
        if s["text"]:
            out.append(f"- Text, by amount of text: {_pct(s['text'])}")
        if s["accents"]:
            out.append("- Accent candidates: " + ", ".join(a["c"] for a in s["accents"]))
        out.append("")
    d, b = s["display"], s["body"]
    if d or b or s["scale"]:
        out.append("## Type")
        if d:
            out.append(f'- Display: {d["family"]} {d["px"]:g}px/{d["weight"]}, letter-spacing {d["ls"]:g}em, line-height {d["lh"]:g}'
                       + (", uppercase" if d["upper"] else ""))
        if b:
            out.append(f'- Body: {b["family"]} {b["px"]:g}px, line-height {b["lh"]:g}px')
        if s["scale"]:
            out.append("- Scale (px/weight): " + ", ".join(f'{x["px"]:g}/{x["weight"]}' for x in s["scale"]))
        if s["families"]:
            out.append("- Families by text share: " + ", ".join(f'{f["name"]} {f["pct"]}%' for f in s["families"]))
        out.append("")
    shape = [(n, v) for n, v in (("Radii", s["radii"]), ("Shadows", s["shadows"]), ("Borders", s["borders"])) if v]
    if shape or s["spacing"]:
        out.append("## Shape")
        for n, v in shape:
            out.append(f"- {n}: " + "; ".join(f'{x["v"]} ({x["n"]}×)' for x in v[:5]))
        if s["spacing"]:
            out.append(f'- Spacing: {s["spacing"]}')
        out.append("")
    if s["buttons"]:
        out.append("## Buttons")
        for x in s["buttons"][:4]:
            out.append(f'- {"filled " + x["fill"] if x["filled"] else "outline"}, text {x["text"]}, radius {x["radius"]}, padding {x["padding"]}, '
                       f'{x["size"]:g}px/{x["weight"]}' + (f', border {x["border"]}' if x["border"] else ""))
        out.append("")
    if s["motion"] or s["declared"]:
        out.append("## Motion")
        if s["libs"]:
            out.append(f'- Libraries: {s["libs"]}')
        for group, label in (("load", "On load"), ("scroll", "On scroll"), ("loop", "Looping")):
            for m in [m for m in s["motion"] if m["group"] == group][:8]:
                bits = [f'{m["ms"]}ms' if m["ms"] else "", m["ease"] + (f' ({m["easeName"]})' if m["easeName"] else ""),
                        f'{m["delay"]}ms delay' if m["delay"] else "", f'{m["stagger"]}ms stagger' if m["stagger"] else "",
                        m["when"], "infinite" if m["infinite"] else "", "approximate" if m["approx"] else ""]
                what = json.dumps(m["kf"]) if m.get("kf") else (", ".join(" ".join(p) for p in m["pairs"]) if m.get("pairs") else
                       (f'animation {m["name"]}' if m.get("name") else ("transition on " + ", ".join(m["props"]) if m.get("props") else m["kind"])))
                out.append(f'- {label}, {m["n"]}× {m["label"]}: {what}; ' + ", ".join(x for x in bits if x))
        for t in s["declared"][:6]:
            out.append(f'- Declared transition on {t["props"]}: {t["ms"]}ms {t["ease"]} ({t["n"]} elements)')
        for name, css in list(s["keyframes"].items())[:4]:
            out += ["```css", css, "```"]
        out.append("")
    if s["gaps"]:
        out += ["## Not captured (don't invent these)"] + [f"- {g}" for g in s["gaps"]] + [""]
    if cited:
        out += ["## Patterns in this book built on it", ", ".join(cited), ""]
    out.append("Rules: " + RULES)
    return "\n".join(out).strip() + "\n"


# ---------------------------------------------------------------- patterns
def pattern_item(p, patterns, by_clip, href):
    techniques = [t["key"] for t in patterns if t["type"] == "technique" and p["key"] in t["languages"]]
    return dict(
        id=p["key"], kind=p["type"], facet=p["facet"] or None, title=p["title"], status=p["status"],
        summary=p["summary"], use_when=p["use"], avoid_when=p["avoid"],
        languages=p["languages"] if p["type"] == "technique" else None,
        techniques=techniques if p["type"] == "language" else None,
        swatches=p["swatches"] or None, recipe=p["recipe"], specimen_html=p["specimen"] or None,
        evidence=[dict(site=e["name"], measured=e["quote"],
                       clip=href(f'agents/clips/{e["clip"]}.json') if e["clip"] in by_clip else None) for e in p["proof"]],
        from_book=p["from_book"] or None, source=p["source"] or None,
        prompt=p["prompt"])


# ---------------------------------------------------------------- the menu
def write_agents(site, book, patterns, clips, collections):
    """Write llms.txt and agents/ into a book folder. Returns the number of item files written."""
    url, title = book.get("url") or "", book.get("title") or "An Artspo book"
    href = _href(url)
    shop = [c for c in clips if has_measurements(c)]
    pending = len(clips) - len(shop)
    by_clip = {c["key"]: c for c in shop}
    cites = {}
    for p in patterns:
        for k in p["evidence"] + p["partial"]:
            cites.setdefault(k, []).append(p["key"])
    langs = [p for p in patterns if p["type"] == "language"]
    techs = [p for p in patterns if p["type"] == "technique"]

    root = site / "agents"
    for sub in ("patterns", "clips"):
        d = root / sub
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("*.json"):  # a rebuild drops items that left the book
            old.unlink()
    dump = lambda path, obj: path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    for p in patterns:
        dump(root / "patterns" / f'{slug(p["key"])}.json', pattern_item(p, patterns, by_clip, href))
    for c in shop:
        cited = cites.get(c["key"], [])
        dump(root / "clips" / f'{c["key"]}.json', dict(
            key=c["key"], site=c["host"], url=c["url"], title=c["title"], collection=c["collection"], clipped=c["clipped"],
            patterns=[href(f"agents/patterns/{slug(k)}.json") for k in cited], measured=clip_sheet(c),
            prompt=clip_prompt(c, book, [next(p["title"] for p in patterns if p["key"] == k) for k in cited])))

    def entry(p):
        e = dict(id=p["key"], title=p["title"], status=p["status"], what=p["summary"],
                 seen_in=len(p["evidence"]), href=href(f'agents/patterns/{slug(p["key"])}.json'))
        if p["type"] == "language":
            e["swatches"] = p["swatches"]
            e["techniques"] = [t["key"] for t in techs if p["key"] in t["languages"]]
        elif p["languages"]:
            e["languages"] = p["languages"]
        if p["starred"]:
            e["starred"] = True
        return e

    def clip_entry(c):
        s = c["sheet"]
        return dict(key=c["key"], site=c["host"], title=c["title"], collection=c["collection"], clipped=c["clipped"],
                    swatches=c["swatches"], display=(s["display"] or {}).get("family") or None,
                    body=(s["body"] or {}).get("family") or None, motion=len(s["motion"]), libraries=c["libs"] or None,
                    patterns=cites.get(c["key"], []), href=href(f'agents/clips/{c["key"]}.json'))

    counts = dict(languages=len(langs), techniques=len(techs), clips=len(shop))
    if pending:
        counts["clips_pending_inspection"] = pending
    order = lambda p: (not p["starred"], p["status"] != "established", -len(p["evidence"]), p["title"])
    menu = dict(
        artbook=FORMAT, title=title, url=url or None, built=book.get("built"), made_with=SKILL,
        how_to_shop=[
            "Pick one language for the overall look, or techniques (by facet) for single moves. Starred and established items are the strongest.",
            "Fetch the href of each item you choose. Its `prompt` field stands alone: paste it into your working context and build from it.",
            "For raw numbers, fetch a clip: one measured site's palette, type scale, radii, buttons and motion timing.",
            "To take everything at once, read artbook.md. To keep these patterns in your user's own Artspo library, run the importer below."],
        rules=RULES,
        counts=counts,
        languages=[entry(p) for p in sorted(langs, key=order)],
        techniques={f: [entry(p) for p in sorted((t for t in techs if (t["facet"] or "other") == f), key=order)]
                    for f in FACETS + ("other",) if any((t["facet"] or "other") == f for t in techs)},
        clips=[clip_entry(c) for c in sorted(shop, key=lambda c: c["clipped"], reverse=True)],
        collections=[dict(key=c["key"], title=c["title"], brief=c["brief"] or None, clips=sum(1 for k in shop if k["collection"] == c["key"]))
                     for c in collections if any(k["collection"] == c["key"] for k in shop)],
        whole_book=dict(markdown=href("artbook.md"), page=href("") or "index.html"),
        remix=dict(skill=SKILL, install="npx skills add bryfeng/artspo",
                   import_book=f'python3 import_book.py {href("artbook.md")}'))
    dump(root / "menu.json", menu)
    (site / "llms.txt").write_text(llms_txt(menu, href), encoding="utf-8")
    return len(patterns) + len(shop)


def llms_txt(menu, href):
    c = menu["counts"]
    n = lambda k, w: f"{k} {w}{'' if k == 1 else 's'}"
    out = [f'# {menu["title"]}', "",
           f'> An Artspo book: {n(c["languages"], "design language")}, {n(c["techniques"], "technique")} and '
           f'{n(c["clips"], "measured website")} (palette, type, shape and motion timing), for coding agents to build from. '
           "Every item carries a standalone prompt.", "",
           "Start with the menu: it lists everything with facets and one line each. Fetch only the items that fit your "
           "brief; each one's `prompt` field works on its own. Recipes are generic reconstructions from measurements, "
           "never a site's code.", "",
           "## Shop", "",
           f'- [Menu]({href("agents/menu.json")}): every language, technique and clip, by facet, with links',
           f'- [Whole book]({href("artbook.md")}): all patterns and works as one Markdown file',
           f'- [Browse]({href("") or "index.html"}): the same book as a page, with live specimens', "",
           "## Languages", ""]
    out += [f'- [{p["title"]}]({p["href"]}): {p["what"]}' for p in menu["languages"]]
    for facet, items in menu["techniques"].items():
        out += ["", f"## Techniques: {facet}", ""] + [f'- [{p["title"]}]({p["href"]}): {p["what"]}' for p in items]
    if menu["clips"]:
        out += ["", "## Measured sites", ""]
        for k in menu["clips"]:
            bits = [", ".join(k["swatches"][:3]), k["display"] and f'display {k["display"]}', k["motion"] and f'{k["motion"]} animations']
            out.append(f'- [{k["site"]}]({k["href"]}): ' + "; ".join(b for b in bits if b))
    out += ["", "## Optional", "",
            f'- [Artspo]({menu["made_with"]}): the Chrome extension and agent skill that measured these sites. '
            f'Install the skill with `{menu["remix"]["install"]}`, then import this book with `{menu["remix"]["import_book"]}`',
            "", "Rules: " + menu["rules"]]
    return "\n".join(out).strip() + "\n"
