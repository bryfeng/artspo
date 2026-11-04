---
name: artspo
description: Use when the user wants design, branding or UI work drawn from their Artspo library — websites they clipped as inspiration, stored as clip.md folders (usually ~/Downloads/artspo). Covers reading clips, analyzing the library into reusable patterns and a report, making works (tokens, motion specs, pages) from patterns and clips, rebuilding the catalogue page, publishing it as a shareable book with copyable prompts, and importing other people's books.
---

# Artspo

Artspo is a Chrome extension that clips websites as design inspiration. The library has four layers:

- **Clips** are evidence: one site each, measured, with the user's note. They never change after inspection.
- **Patterns** are knowledge: design *languages* (coherent wholes, "what should this feel like") and
  *techniques* (single reusable moves, "how do I make it feel that way"), each citing the clips behind it.
  Patterns accumulate across analyses, and they are what gets reused.
- **Works** are ours: what the user and their agents make from the library (brand directions, tokens, motion
  specs, pages), each listing the patterns and clips it came from, plus the user's verdict on it.
- **Reports** are views: a dated snapshot explaining the library to a person. They can be regenerated.

Your job is to keep that chain intact: every work traces to patterns, every pattern traces to clips.
`catalogue.html` shows all of it on one page, with that lineage clickable.

Skill version 0.8.0. The library's `AGENTS.md` ends with the version of the extension that wrote it. If that's newer
than this skill, tell the user once that their skill is out of date and how to update it:
`curl -fsSL https://raw.githubusercontent.com/bryfeng/artspo/main/install.sh | sh`, then restart the agent.

## Find the library

- Default location: `~/Downloads/artspo/` (Windows: `%USERPROFILE%\Downloads\artspo\`). The extension's setup can
  put it in another folder under Downloads (e.g. `~/Downloads/Design/artspo`), or the user may have linked it to a
  folder elsewhere. Use a path the user gives if they name one; otherwise look for the folder that holds `AGENTS.md`
  next to collection folders of `clip.md` files.
- If it doesn't exist, the user hasn't clipped anything yet. Say so; don't invent clips.

```
artspo/
  <collection>/                     e.g. fintech-serious, launch-moodboard, inbox: a folder, and a project
    collection.md                   the collection's brief and the links added to it as a list (written by the extension)
    <date>_<site>_<id>/
      clip.md                       the record — always read this first
      seen.jpg                      viewport exactly as the user saw it when clipping
      full.jpg                      full page, 1440px wide
      filmstrip/NN.jpg              viewport frames top → bottom during an automated scroll
  patterns/
    INDEX.md                        every pattern, one line each; starred first
    languages/<id>.md
    techniques/<color|type|shape|layout|motion>/<id>.md
    imported/<book>/                patterns from someone else's book (import_book.py). Read-only: re-import to update
  works/
    <date>_<short-name>/
      work.md                       the record: what it is, what it came from, the user's verdict
      preview.jpg                   what it looks like (optional, recommended)
      …                             the work itself: tokens.css, index.html, spec.md…
  reports/<date>_library-review.md (+ .html)
  catalogue.html                    clips, patterns and works on one page; rebuilt by catalogue.py
```

Older libraries may have `_generated/` instead of `works/`. The catalogue lists both; write new works to `works/`.

## Reading clips

1. List the collections. If the user didn't name one, ask which, or use the one whose name fits the request.
   A collection is also a project: read its `collection.md` first. The **Brief** says what it's for and outranks
   your own reading of the clips; the **Links** say why each list-added clip is there.
2. Read the frontmatter and **Note** of every clip in scope before going deeper.
3. Read the full `clip.md` only for clips you'll draw from. Open images only to judge feel: `seen.jpg` for the
   impression, `full.jpg` for structure, the filmstrip for pacing.
4. There is one clip per page: clipping a page again updates its folder. Skip clips whose frontmatter says
   `status: superseded` (duplicates left by older versions; `superseded_by` points to the current one).
5. Trust the frame range listed under **Files** in clip.md (e.g. `filmstrip/01–09.jpg`). A re-inspected clip can
   still have older, higher-numbered frames on disk; ignore those.

| clip.md section | Trust |
|---|---|
| **Note** | The user's own words about *why* they saved it. Weight it above everything else. |
| Palette, Typography, Shape & spacing, Buttons | Measured from computed styles. Exact. |
| Motion: CSS animations/transitions, `element.animate`, GSAP lines | Exact durations, easings, staggers. |
| Motion lines marked "JS-driven, sampled from inline styles" | Approximate: duration ±1 frame, easing unknown. |
| Declared transitions | Hover/focus timings that were never triggered. The end state is unknown. |
| Not captured | Known gaps. Never fill these with guesses. |
| Capture diagnostics | If it says THROTTLED, treat that clip's JS motion as unreliable. |

Known extractor noise: element labels can contain inline CSS text (`div "@keyframes …"`), font names can
carry build hashes (`FT Aktual-13a0b…` is FT Aktual), and transparent `rgba(0, 0, 0, 0) 0px 0px 0px 0px`
shadow stacks are Tailwind defaults, not real shadows. Ignore all three.

## Analyze the library

When asked to analyze, review or "break down" the library (or a collection):

1. Read every clip in scope (all clip.md files plus `seen.jpg` and `full.jpg`). Read `patterns/` first if it
   exists: you are updating it, not starting over.
2. **Techniques.** Find moves that recur across clips, per facet: color, type, shape, layout, motion.
   Name each one generically, by what it *does* (`highlighter-marks`, `soft-rise-reveal`), never after a site.
   It's `established` with 2+ clips, `emerging` with one strong example.
3. **Languages.** Cluster clips that share several techniques plus a feel. Name the language generically.
   A language needs 2+ clips to be established; a single strong outlier is `emerging`. Clips that are not
   comparable (e.g. a logged-in app screen among marketing pages) are outliers, not forced into a cluster.
4. **Evidence.** Every pattern cites clips. Quote measurements *verbatim* from clip.md so they can be checked
   by search; mark visual observations as coming from `seen.jpg` or `full.jpg`. Never cite a number you
   didn't find.
5. **Updating.** A new clip either adds evidence to an existing pattern (append it, maybe promote
   `emerging` → `established`) or proposes a new pattern. Don't rename or delete patterns the user has starred.
   Never change `starred`; that's the user's.
6. **Report.** Write `reports/<date>_library-review.md` with: clips at a glance (site, what it is, language,
   signature move); a taste readout (what the library says as a whole, and what's missing; say plainly when
   it's inferred because clips have no notes); languages; the technique catalog; motion tempo across the
   library; capture issues; clips that would strengthen weak patterns.

### Pattern file format

```markdown
---
id: soft-rise-reveal
kind: technique                 # or language
facet: motion                   # techniques only: color | type | shape | layout | motion
status: established             # or emerging
starred: false                  # the user's bookmark; never change it
evidence: [inbox/2026-10-14_era-world_cics, …]
languages: [humane-editorial]   # techniques only
updated: 2026-10-15
---
# Soft rise reveal
One- or two-sentence description of the move.
## Recipe            ← rebuilt, generic CSS/spec from the measurements. Never a site's code.
## Specimen          ← one ```html block: a live demo of the move (rules below)
## Use when / ## Avoid when
## Pairs with        ← links to other patterns
## Evidence          ← one line per clip: verbatim quote from clip.md, or [seen.jpg]/[full.jpg] observation
```

Language files carry: the feel (one line), defining traits per facet, the techniques they use, starter tokens
(CSS custom properties), a specimen, use when / avoid when, and evidence.

**Specimens** are what make a pattern visible in the catalogue, so every pattern gets one. The rules:
- One ```html block: a `<style>` plus markup wrapped in `<div class="s">`. Style from `.s` and below; never `:root`,
  `html` or `body` (the catalogue renders it inside a shadow root, which scopes the CSS).
- HTML and CSS only: no scripts, no external images or fonts (system font stacks; data: SVG is fine).
- Generic content in the pattern's own values: invented product names and copy, never a site's text or assets.
- Sized for a frame about 760 × 340 px. Motion plays on load (the catalogue has Replay); loops may be infinite.
  Add a short caption in mono saying the values (`600ms quint-out · 16px rise`).
- Respect reduced motion: `@media (prefers-reduced-motion: reduce)` should stop or shorten it.
- A language's specimen is a tiny page in that language, not a list of its techniques. Keep `patterns/INDEX.md` as one table row per
pattern, with starred patterns listed first.

## Generating from the library

**Prefer patterns over raw clips.** Read `patterns/INDEX.md` first. Starred patterns are the user's menu: use
them unless the request points elsewhere. Drop down to clips only for details a pattern doesn't carry.

**For a collection.** "Make a launch page for launch-moodboard." Start from that collection's brief, use its
clips and the patterns they cite, read the verdicts on works already made for it, and set `collection:` in the
new work.md.

**Brand direction.** "Build a brand direction from <collection>."
Pick one language as the base, then add 2–4 techniques as the differentiators. A language alone tends
toward a look many sites already share; the techniques are what make it specific. Output:
- `tokens.css`: CSS custom properties for color, type, radius, spacing, motion (durations and easings)
- `rationale.md`: each choice, the pattern it came from, and that pattern's source clips; plus what you left out

**Mix and match.** "Palette from A, type from B, motion from C."
Take exactly what was asked for. If the pieces clash (contrast, weight, mood), say so and propose the smallest fix.

**Motion spec.** Start from the `motion-timing-tiers` pattern if it exists: pick one duration per band and
one easing per role (ease-out for arrivals, standard for UI state, springs only for characters, linear for loops).

**Build it.** Build from tokens and recipes, not from screenshots alone. Then compare against the source
clips' `seen.jpg`.

Write each piece to `artspo/works/<date>_<short-name>/` with a `work.md` (below) unless the user asks otherwise.
Then rebuild the catalogue.

## Works

A work is anything made from the library, by an agent or by the user. Its `work.md`:

```markdown
---
id: light-table
title: Light table
kind: brand-direction           # brand-direction | tokens | motion-spec | page | component | other
status: draft                   # draft | kept | shipped | dropped. The user's call: agents only ever write draft.
starred: false                  # the user's; never change it
made_by: claude                 # which agent, or "you" for the user's own work
made: 2026-10-15
collection: launch-moodboard     # the collection (project) it was made for, if any
patterns: [research-index, highlighter-marks]        # pattern ids it was made from
clips: [inbox/2026-10-14_preferencemodel-com_by8f]   # clips drawn on directly, beyond those patterns
preview: preview.jpg
files: [tokens.css, rationale.md]
---
# Light table
One or two sentences: what it is and what it's for.
## Brief          ← what was asked, in the user's terms
## Made from      ← each pattern (and clip) and what was taken from it, or how it was changed
## Left out       ← what you considered and didn't use, and why
## Verdict        ← the user's words. Leave the placeholder; never write a verdict yourself.
```

- **Preview.** If you can render the work, save a 1440×900 screenshot as `preview.jpg`. Otherwise omit it.
- **Iterating.** A new version of a work is a new folder (`…_light-table-v2`), with the earlier one listed under
  Made from. Don't overwrite a work the user has given a verdict.
- **The user's own work** goes in the same shape with `made_by: you`. Ask them what it drew on; don't guess.
- **Verdicts are evidence.** When generating, read the verdicts on earlier works: a `dropped` work with a reason
  tells you what not to repeat, a `kept` or `shipped` one tells you what landed.

## Catalogue

`catalogue.py` ships next to this file (in the Artspo repo: `extension/skills/artspo/catalogue.py`). It needs only
Python 3 and reads `catalogue.css`, `catalogue.js` and `catalogue.html.in` next to it. After you add a work or
analyze the library, or when the user asks, rebuild the private catalogue:

```
python3 <this skill's folder>/catalogue.py ~/Downloads/artspo
```

That writes `artspo/catalogue.html`: a grid of everything, and a viewer that opens any item. A clip shows its
elements rebuilt from clip.md (palette, type, buttons, radii, shadows, motion replayed on a timeline) and its
screens; a pattern plays its specimen and lists its evidence and recipe; a work shows its preview and files.
The more exact clip.md and the specimens are, the better it shows. The extension's popup links to it
(Catalogue ↗). If you can't run Python, say so and skip it: the files are the source of truth, and the page is
only a view.

## Publish a book

A published catalogue is a **book**: a page people browse, where every pattern and work has a **Copy prompt** that
stands alone (the whole pattern, its tokens or recipe, a reference specimen, and the rules), plus `artbook.md`, the
same book as one Markdown file for agents, plus an **agent catalogue** agents can shop item by item: `llms.txt` and
`agents/menu.json` list every language, technique and measured clip with a link to its own JSON, and each item's
`prompt` stands alone. Always build the public edition.

1. **Build it.** For a link people will share, build a site folder with the address it will live at:
   `python3 catalogue.py ~/Downloads/artspo --public --site ~/code/artbook --title "<Name>'s artbook" --url https://<user>.github.io/artbook/`
   - `--url` gives shared links a preview card (`cover.png`, made from the languages' colors; `--cover FILE` for
     your own 1200×630 image, e.g. a screenshot of the page). A domain that isn't github.io also gets a `CNAME` file.
   - `--collection <name>` makes a book of one collection: its brief, clips, the works made for it, their patterns.
   - Clips appear as rebuilt element sheets with no screenshots. Add `--thumbnails` only if the user wants each
     site's screenshot shown; it's their call, since those images belong to the sites.
   - `--no-works` leaves works out, for a book of patterns and clips only (ask if works were made for clients).
   - A book in a subfolder of a site (`--url https://artbook.dev/library/`) gets no `CNAME`; the parent site has it.
   - One self-contained file instead of a folder: `--public --embed --out FILE` (no artbook.md, cover or agent catalogue).
2. **Show the user what was left out.** The script prints it: clips marked `private: true`, clips that look like
   logged-in pages (app., dashboard, workspace URLs), plus notes, page text, full-page shots, filmstrips, raw
   clip.md and file paths, which the public edition always drops. Ask before publishing if anything listed
   looks wrong. A logged-in clip goes public only if the user sets `public: true` in its clip.md themselves.
   Notes go public only with `--with-notes`, and only if the user asks for it.
3. **Check what's left.** Search `index.html`, `artbook.md`, `llms.txt` and `agents/` for the user's name, email, workspace or account IDs.
   Patterns and works are written by agents and can quote clips; fix the source file if anything personal slipped in.
4. **Publish where the user says**, never without their go-ahead. For GitHub Pages with the `gh` CLI signed in
   (`gh auth status`), do it all yourself from the site folder:
   ```
   git init -b main && git add -A && git commit -m "Artbook"
   gh repo create <repo> --public --source . --push
   gh api -X POST repos/<owner>/<repo>/pages -f "source[branch]=main" -f "source[path]=/"
   ```
   The book is live at `https://<owner>.github.io/<repo>/` a minute or two later. To update: rebuild into the same
   folder, then commit and push. Without `gh`, give the user the steps in the repo's `docs/SHARING.md`. Any static
   host works too.
5. **Report the link** and what's in it (counts of works, patterns and clips).

For a friend who also uses Artspo, a book is the way to share: they import it (below). Handing over files works too:
the collection folder (with `collection.md`), the works whose `collection:` is that name, and the pattern files
they list. Apply the same privacy check first.

## Import a book (remix)

When the user wants to use someone else's book ("add Sam's artbook to my library", or gives a book link):

```
python3 <this skill's folder>/import_book.py https://sam.github.io/artbook/ ~/Downloads/artspo
```

If the download fails (no network), fetch `<book>/artbook.md` with your own tools, save it, and pass the file.
Patterns land in `patterns/imported/<book>/`, each crediting its source. Then:
- Refer to an imported pattern as `<id>@<book>` (`soft-rise-reveal@sams-artbook`), including in a work's `patterns:`.
- Never edit imported files; re-running the import replaces them. To adapt one, write your own pattern that cites
  it under `## Pairs with`, and back it with the user's clips if you can.
- Imported patterns have no clips in this library. Treat them as recipes, and say when a choice rests on one.
- Without importing, any agent can use a book directly: read its `artbook.md` (or take one Copy prompt).

## Clip pages for the user (Artspo MCP tools)

If you have the `artspo_*` tools (the Artspo MCP server, bundled with the Claude Code plugin; elsewhere the user
adds `python3 ~/.artspo/mcp/artspo_mcp.py`), you can add pages to the library instead of asking the user to visit each one.

- `artspo_clip` takes up to 25 links, each with an optional note, and a collection. The extension inspects them
  later in the user's own Chrome. Write a note only from what the user said or plainly wants; it becomes the
  clip's Note, which outranks every measurement.
- By default the user approves each request in the Artspo popup (the toolbar badge shows `?`). When the result
  says `awaiting-approval`, tell them, then check `artspo_status` with the same urls. States: `awaiting-approval`,
  `declined`, `queued`, `running`, `done`, `partial`, `failed`, `in-library`, `unknown`.
- Inspection runs when the user is idle. `artspo_process_now` starts it immediately, but it opens tabs in their
  Chrome and shows Chrome's debugging bar, so say so first. Expect about a minute per page.
- Clip only pages the user asked for or agreed to. Never clip logged-in, account or private pages unless they
  explicitly ask; the inspection runs in their real Chrome profile.
- `artspo_list_clips` and `artspo_read` read the library from disk and work without the extension. If you can
  read files directly, that works just as well.

## Rules

- **Rebuild, don't copy.** Never reproduce a site's code, logos, illustrations, photography or copy. Recipes
  are generic reconstructions from measurements.
- **Fonts carry licenses.** If you recommend a webfont from a clip, flag that it needs a license, or suggest
  a free alternative with similar metrics.
- **Attribute every choice** to a pattern, and every pattern to clip folder names.
- **Don't edit clip.md** except to append a `## Deep dive` section (below).
- **Don't decide for the user.** `starred`, a work's `status` beyond draft, and its Verdict are theirs.
- **Credit books.** A choice that comes from an imported pattern names the book it came from.
- **Privacy when sharing.** Publish only the public edition (above). Clips of logged-in pages can contain names and account IDs. Strip those from
  anything meant for other people; patterns should never contain them.

## Optional: deep dive

When exact mechanics matter and the clip lists a gap (privately bundled GSAP, WebGL), you can run a
reverse-engineering tool such as REA against the clip's `url`, if one is available to you. Append findings
to `clip.md` under `## Deep dive`, with the evidence for each claim, and set `depth: deep` in the frontmatter.
Summarize in your own words; don't paste raw tool output. Understand and rebuild — never port the site's code.
