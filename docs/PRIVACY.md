# Artspo privacy

Artspo has no server, no account, no analytics and no tracking. It sends nothing anywhere.

**What it reads.** Only pages you clip. When you clip a page, it takes a screenshot of the visible tab. Later it
opens that same URL in a background tab, scrolls it, and measures its styles and motion. It uses your normal
Chrome profile, so pages behind a login inspect as you see them.

**What it writes.** Files in your library folder (`Downloads/artspo` unless you chose another in setup): `clip.md`, screenshots, and `AGENTS.md`. The
extension also keeps a list of your clips in Chrome's local extension storage, so it can update a clip instead of
duplicating it.

**What it needs, and why.**

| Permission | Why |
|---|---|
| Access to all sites | to read the page you're clipping, screenshot it, and inspect it later |
| `debugger` | to scroll the page with real input, capture full-page screenshots, and record motion from the first frame |
| `downloads`, `downloads.ui`, `offscreen` | to write files into your library folder, without flashing a download for each file |
| `storage` | to remember your clips, collections and settings |
| `idle`, `alarms` | to run inspections while you're away |

**Network.** Inspection loads the page you clipped, plus any stylesheets it uses (to read its animations).
Nothing else.

**Sharing.** Your library stays on your computer until you or your agent publish something. A published book
leaves out logged-in pages, your notes, page text and, unless you ask for them, screenshots of the sites you
clipped. See [SHARING.md](SHARING.md).

**Removing it.** Remove the extension in `chrome://extensions` (this clears its list) and delete
`Downloads/artspo` if you want the files gone too.
