# Artspo privacy

Artspo has no server, no account, no analytics and no tracking. It sends nothing anywhere.

**What it reads.** Only pages you clip. When you clip a page, it takes a screenshot of the visible tab. Later it
opens that same URL in a background tab, scrolls it, and measures its styles and motion. It uses your normal
Chrome profile, so pages behind a login inspect as you see them.

**What it writes.** Files in `Downloads/artspo` on your computer: `clip.md`, screenshots, and `AGENTS.md`. The
extension also keeps a list of your clips in Chrome's local extension storage, so it can update a clip instead of
duplicating it.

**What it needs, and why.**

| Permission | Why |
|---|---|
| Access to all sites | to inspect whichever page you clip |
| `debugger` | to scroll the page with real input, capture full-page screenshots, and record motion from the first frame |
| `tabs`, `activeTab` | to know which page you're clipping and screenshot it |
| `downloads`, `offscreen` | to write files into `Downloads/artspo` |
| `storage` | to remember your clips, collections and settings |
| `idle`, `alarms` | to run inspections while you're away |

**Network.** Inspection loads the page you clipped, plus any stylesheets it uses (to read its animations).
Nothing else.

**Sharing.** Your library stays on your computer until you or your agent publish something. The catalogue's
public edition leaves out logged-in pages, your notes, page text and full-page screenshots. See **Share it** in
the README.

**Removing it.** Remove the extension in `chrome://extensions` (this clears its list) and delete
`Downloads/artspo` if you want the files gone too.
