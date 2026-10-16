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

### Throttling check

Chrome can throttle tabs you aren't looking at, which freezes JS-driven motion. Every pass measures the frame
rate. If the background tab runs under 20 fps, the pass is redone in a small unfocused window. The result is
in each clip's **Capture diagnostics** section (`Mode`, fps, page visibility). If clips keep coming back
`THROTTLED`, open an issue with your OS and Chrome version.

## Limits (also listed per clip under "Not captured")

- Never clicks, so menus, modals and tabs aren't captured.
- Hover states aren't forced. Their timings appear under Declared transitions.
- WebGL, Lottie/Rive and video internals are opaque.
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
| `lib/clipmd.js` | turns measurements into `clip.md` |
| `lib/writer.js` + `offscreen/` | writes files via the downloads API |
| `popup/` | the clipper UI |
| `options/` | Reconnect a library after moving or reinstalling the extension |
| `skills/artspo/SKILL.md` | agent skill (any Agent Skills-compatible agent); also written to the library as `AGENTS.md` |
| `skills/artspo/catalogue.py` (+ `.css`, `.js`, `.html.in`) | builds `catalogue.html`: a grid of clips, patterns and works, and a viewer that rebuilds each clip's elements and plays each pattern's specimen (Python 3, stdlib only) |
