# Artspo in 5 minutes

Artspo turns websites you like into a design library your AI agent can work from. You clip sites in Chrome.
Artspo measures their colors, type, spacing and motion. Then you ask any agent to build something from them.

It works with any agent that can read files: Claude Code, Codex, Cursor, Gemini CLI, Copilot, or a chat app
you upload files to.

## 1. Install (3 min)

1. Clone or unzip Artspo somewhere permanent, **not** inside `~/Downloads/artspo` (that's where your clips go).
   For example `~/code/artspo`.
2. In Chrome, go to `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and
   pick the `extension` folder inside it. Pin Artspo to the toolbar.
3. In a terminal, from the Artspo folder, run `sh install.sh` and restart your agent.

`install.sh` copies the `artspo` skill into each agent's skills folder it finds. To do it by hand, copy
`extension/skills/artspo/` into your agent's skills folder:

| Agent | Skills folder |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Codex and others | `~/.agents/skills/` |
| Cursor | `~/.cursor/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| GitHub Copilot | `~/.copilot/skills/` |

**No skills support?** (a chat app, say) There's nothing to install. The library carries its own instructions
in `AGENTS.md`. Upload or connect the `artspo` folder and start with "Read AGENTS.md first."

## 2. Clip some sites (1 min each)

1. On a site you like, press **Alt+Shift+S**.
2. Write one line about **what caught your eye**. This is the most useful thing you give your agent, so don't skip it.
3. Pick or create a collection (`fintech-serious`, `playful-onboarding`), add tags if you want, then press
   **⌘↵** / **Ctrl+Enter**.

That saves a screenshot instantly. The full inspection runs when you've been away for 2 minutes. You'll see a tab
open and close, and Chrome's "started debugging this browser" bar. To run it now, press **Process now**.

## 3. Ask for something

From any folder (the skill finds your library), or from inside `~/Downloads/artspo`:

> Analyze my artspo library into patterns, then build the catalogue.

> Build a brand direction from my fintech-serious clips: palette, type, shape and motion. Give me tokens.css and
> a rationale that names the pattern and clips behind each choice.

> Palette from the northwind clip, type from the linear clip, motion from whichever clip feels fastest.
> Then build a hero section with it.

Each piece lands in `~/Downloads/artspo/works/` with a `work.md` saying what it was made from. Write your verdict
in its `## Verdict` section and set `status` to `kept`, `shipped` or `dropped`; agents read verdicts before
making the next one.

## 4. Browse and share

**Catalogue ↗** in the popup opens `catalogue.html`: every clip, pattern and work, with clips rebuilt from their
measurements and patterns playing live. Arrow keys flip through.

To share it, ask your agent to "publish a public edition of my catalogue", or see **Share it** in the README.

## Good to know

- **Your note matters more than anything measured.** "The count-up on scroll feels earned" steers the agent
  more than a hex value.
- Each `clip.md` ends with **Not captured**: clicks, hover end-states, WebGL and video internals. Agents are
  told not to guess those.
- Pages behind a login work, because inspection uses your normal Chrome profile. They stay out of the public
  catalogue unless you opt them in.
- Use it for inspiration, not cloning. The skill tells agents to rebuild from measurements, never copy a site's
  code, logos or copy, and to check font licenses.
