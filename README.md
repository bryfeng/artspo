# Artspo

Clip websites you like. Artspo measures their color, type, shape and motion, files each one as a folder your
AI agent can read, and turns the collection into a catalogue you can browse, build from, and share.

Two parts, both in this repo:

- **The Chrome extension** (`extension/`) clips pages. Clipping is instant; the full inspection runs later,
  while you're away from the computer.
- **The agent skill** (`extension/skills/artspo/`) teaches any coding agent (Claude Code, Codex, Cursor,
  Gemini CLI, Copilot) to read the library, distill it into reusable patterns, make things from it, and build
  the catalogue.

There's no server and no account. Everything lives in `~/Downloads/artspo` on your computer.

## How it fits together

```
you clip a site ──▶ clip.md + screenshots        (the extension)         clips    = evidence
your agent reads ─▶ patterns/  languages, techniques with live specimens   patterns = knowledge
you ask for work ─▶ works/     tokens, pages, specs, each citing its sources   works    = what you make
catalogue.py ─────▶ catalogue.html: browse everything, trace any work back to the sites behind it
```

## Install

You need Chrome 118 or newer. Python 3 is optional; agents use it to build the catalogue page.

1. **Get the code.** Clone this repo, or download and unzip the release, somewhere permanent:
   `~/code/artspo`, for example. Don't put it inside `~/Downloads/artspo`, which is where your clips go.
2. **Load the extension.** Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and
   choose the `extension` folder. Pin Artspo to the toolbar.
3. **Install the skill.** From the repo folder, run `sh install.sh`, then restart your agent. On Windows, or
   for an agent the script doesn't know, copy `extension/skills/artspo/` into your agent's skills folder.

Updating later: `git pull` (or unzip the new release over the old folder), click ↻ on Artspo in
`chrome://extensions`, and run `sh install.sh` again.

**Moving or reinstalling the extension?** An unpacked extension's memory is tied to its folder, so a new
location starts with an empty list. Your clips are safe on disk: open Artspo's **Options** (or click "Reconnect"
in an empty popup), choose your `artspo` folder, and it relearns them.

## Use

1. On a site you like, press **Alt+Shift+S**.
2. Write one line about what caught your eye. Your note steers your agent more than any measurement.
3. Pick a collection, add tags if you want, and press **⌘↵** (Ctrl+Enter).

The inspection runs after you've been idle for 2 minutes (adjustable), or now with **Process now**. While it
runs you'll see a tab open and close and Chrome's "started debugging this browser" bar; that's how it scrolls
the page and records motion. Clipping the same page again updates its folder. ↻ re-inspects a clip with the
latest version of Artspo.

Then ask your agent, for example:

> Analyze my artspo library into patterns, then build the catalogue.

> Build a brand direction from my fintech-serious clips. Give me tokens.css and a rationale that names the
> pattern and clips behind each choice.

> Motion spec for a launch page: soft-rise-reveal plus the four-tier timing.

[docs/TUTORIAL.md](docs/TUTORIAL.md) walks through it in five minutes.

## The catalogue

`catalogue.html` in your library shows clips, patterns and works on one page. Open any item to see it:

- **A clip:** its palette, type, buttons, shapes and shadows rebuilt from the measurements, its motion
  replayed on a timeline, and its filmstrip.
- **A pattern:** a live specimen of the move, the evidence behind it, and the recipe.
- **A work:** the thing itself, and everything it was made from.

Your agent rebuilds it after each change; **Catalogue ↗** in the popup opens it. To build it yourself:

```sh
python3 extension/skills/artspo/catalogue.py ~/Downloads/artspo
```

### Share it

Always share the **public edition**:

```sh
# a folder for GitHub Pages, Netlify, Cloudflare Pages or any static host
python3 extension/skills/artspo/catalogue.py ~/Downloads/artspo --public --site ~/artspo-site --title "Your Name's Artspo"
npx netlify deploy --dir ~/artspo-site --prod        # or push the folder to a gh-pages branch, etc.

# or one self-contained file
python3 extension/skills/artspo/catalogue.py ~/Downloads/artspo --public --embed --out ~/artspo.html
```

The public edition leaves out:

- clips marked `private: true`, and clips that look like logged-in pages (`app.`, dashboards, workspaces);
- your notes, unless you add `--with-notes`;
- page text, full-page shots, filmstrips, raw `clip.md` and file paths.

It prints what it left out. Each clip appears as a reference thumbnail with a link, plus its rebuilt elements.
Screenshots and measurements belong to those sites; patterns, specimens and works are yours.

Or ask your agent: "Publish a public edition of my catalogue." The skill walks it through the same steps and has
it confirm with you before anything goes online.

## What's in your library

```
~/Downloads/artspo/
  AGENTS.md                  the skill's instructions, for agents that don't support skills (written by the extension)
  <collection>/<date>_<site>_<id>/
    clip.md                  palette, type, shape, buttons, motion, gaps, diagnostics, your note
    seen.jpg                 what you saw when you clipped
    full.jpg  filmstrip/     the full page, and frames from the scroll pass
  patterns/                  languages and techniques, each citing its clips   (written by your agent)
  works/<date>_<name>/       what you made, with what it came from and your verdict   (your agent, or you)
  catalogue.html             the catalogue   (built by catalogue.py)
```

## More

- [docs/TUTORIAL.md](docs/TUTORIAL.md): five-minute walkthrough
- [docs/INSPECTION.md](docs/INSPECTION.md): what the inspection measures, how, and its limits
- [docs/PRIVACY.md](docs/PRIVACY.md): what Artspo touches and where data goes (nowhere)
- [docs/BACKLOG.md](docs/BACKLOG.md): what's planned
- `sh package.sh` builds the release zips (the whole repo, and the extension alone for the Chrome Web Store)
