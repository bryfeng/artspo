# Inspection

What Artspo measures when it inspects a clipped page, how, and what it can't see.

## How it works

1. Opens the URL in a background tab at a 1440×900 viewport and injects instrumentation before the page's
   own scripts run, so load animations are recorded from the first frame.
2. Records CSS animations/transitions as they fire, `element.animate()` calls, GSAP calls (when GSAP is
   assigned to `window`), and inline-style changes. The last one is how JS-driven motion from bundled GSAP
   or Framer Motion gets sampled.
3. Scrolls with real wheel events (so smooth-scroll libraries respond), sampling surface colors and
   capturing filmstrip frames.
4. Extracts computed tokens: area-weighted surface colors, text colors, type scale, radii, shadows, spacing,
   button styles, declared transitions, `@keyframes` (fetching cross-origin stylesheets when needed), and
   library signals.
5. Saves the page's own media into the clip's `assets/` folder and lists it under **Media** in clip.md (below).

### Media

The pass watches what the page loads from its first request, then takes each file's bytes from Chrome's
network cache, so nothing is downloaded twice.

| Kind | Saved as | Measured |
|---|---|---|
| Inline SVG (logo, illustrations, feature icons) | `assets/svg/NN_<role>.svg`, with the page's CSS paint (fill, stroke, width, caps) written into each element as inline style, in sRGB, so it looks the same on its own (a `<style>` block inside the SVG can't override it); sprite icons (`<use href="#…">`) are drawn in full; art that only appears on hover is saved visible and marked | role, size, viewBox, line or solid, stroke width, caps and joins, colors; the icon set is summarized as one line (grid, stroke, caps, ink) |
| Images (`<img>`, CSS backgrounds, video posters, images loaded but not placed) | `assets/img/NN_<name>.<ext>` in the original format | role (logo, partner logo, hero, avatar, icon, social icon, background), shown size and file size, object-fit, radius, filter, blend, mask, tiling, alt text |
| Video | `assets/video/NN_<name>.<ext>`, when it's one file under 15 MB | autoplay, loop, muted, duration, file and shown size, poster |
| Lottie (`.json`, `.lottie`) | `assets/lottie/` | frame rate, length, size, layers, keyframes and their easing curves, markers |
| Rive | `assets/rive/` | size only; state machines aren't parsed |
| Site icon, share image | `assets/icon/`, `assets/share.<ext>` | sizes |
| Webfonts | not saved: fonts are licensed | where they come from (Google Fonts, Adobe Fonts, self-hosted) and their format |

**Main content only.** Artspo saves the site's own logo (up to 3 versions) and what the main content shows. It
counts the rest under **Left out on purpose** instead of saving it: UI icons (anything inside a link or button,
in the nav, or under 32px; the icon-system line is still measured over all of them), social and integration
icons, partner logos (described once as a logo wall: count, size, ink, filter, opacity), anything else in the
nav, footer, sidebars, dialogs and cookie layers, images shown 48px or smaller, and images the page loaded but
never placed when they're under 20 KB. Only the biggest site icon is kept.

Limits per clip: 60 SVGs, 80 images (8 MB each), 4 videos (15 MB each), 8 Lottie files, 60 MB in all. What goes
over is listed under **Not saved**. Video streamed in pieces (most long or adaptive video) has no single file
to save; its facts and poster are still recorded. An address that answers with a web page instead of the file
(a 404 page or an app shell, common for video with no source yet and for stale icon links) is never saved; it's
listed as not saved. A file Chrome's cache no longer has is fetched again, and the
share image is always fetched, since pages don't load it themselves.

### Throttling check

Chrome can throttle tabs you aren't looking at, which freezes JS-driven motion. Every pass measures the frame
rate. If the background tab runs under 20 fps, the pass is redone in a small unfocused window. The result is
in each clip's **Capture diagnostics** section (`Mode`, fps, page visibility). If clips keep coming back
`THROTTLED`, open an issue with your OS and Chrome version.

## Limits (also listed per clip under "Not captured")

- Never clicks, so menus, modals and tabs aren't captured.
- Hover states aren't forced. Their timings appear under Declared transitions.
- WebGL scenes and video are opaque: video files are saved to watch, but their motion isn't measured. Rive
  files are saved but not parsed. Lottie files are read in full.
- With privately bundled GSAP, motion is sampled: approximate durations, no easing.
  That's the case for a deep dive with a reverse-engineering tool (see the skill).
- Pages behind a login inspect fine, because the pass uses your normal Chrome profile.

## Motion in clip.md

Every motion line says how it was measured, which tells you how far to trust it:

- CSS animations and transitions, `element.animate()` and GSAP calls: exact duration, easing, delay and stagger.
- Lines marked "JS-driven, sampled from inline styles": approximate (duration within a frame, easing unknown).
- **Declared transitions**: hover and focus timings found in the CSS that never fired during capture. The
  timing is exact; the end state is unknown.

The catalogue replays these on a timeline, and marks the approximate ones.

## Files (in `extension/`)

| File | Role |
|---|---|
| `background.js` | queue, idle trigger, clip + job runner |
| `lib/inspector.js` | the DevTools Protocol pass |
| `inject/instrument.js` | runs in the page from document start; records motion |
| `inject/extract.js` | runs in the page at the end; measures tokens |
| `lib/media.js` | picks the page's media out of what it loaded, saves it, reads Lottie files |
| `lib/clipmd.js` | turns measurements into `clip.md` |
| `lib/writer.js` + `offscreen/` | writes files via the downloads API |
| `popup/` | the clipper UI |
| `options/` | Setup: library folder, collections, inspection timing, and reconnecting a library after moving or reinstalling |
| `skills/artspo/SKILL.md` | agent skill (any Agent Skills-compatible agent); also written to the library as `AGENTS.md` |
| `skills/artspo/catalogue.py` (+ `.css`, `.js`, `.html.in`) | builds `catalogue.html`: a grid of clips, patterns and works, and a viewer that rebuilds each clip's elements and plays each pattern's specimen (Python 3, stdlib only) |
