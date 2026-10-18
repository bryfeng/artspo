# Artspo backlog

Parked features, roughly in priority order. Nothing here is built yet.

## Next up

### Show when each clip was last inspected
Each row in the popup shows when the page was *clipped* ("inbox · 2d ago"), not when it was last *inspected*. After a ↻ re-inspect, there's no way to tell fresh measurements from stale ones without opening clip.md.

- Show both in the row subtitle: `inbox · clipped 2d ago · inspected 3h ago`. If they're the same run, show just one.
- Tooltip with the absolute local time, and the extension version that did the inspection (`inspected 2026-10-15 18:03 · v0.3.3`).
- While queued or running, keep showing the previous inspection time ("last inspected 2d ago") next to the status, so a re-inspect doesn't wipe it.
- Optional: flag rows inspected by an older version of the inspector (dim "older inspector" hint on the ↻ button), since inspector fixes are the main reason to re-inspect.

Implementation notes:
- `runJob` already sets `diag.inspectedAt` and writes `inspected:` into clip.md frontmatter, but the job record doesn't keep it. Store `inspectedAt` and `inspectedWith` (manifest version) on the job when a run finishes.
- Existing jobs have no `inspectedAt`. Backfill from `diag` if present, else fall back to "inspected (time unknown)" until the next ↻.
- Add `inspected_with: 0.4.x` to the clip.md frontmatter so agents can see it too, and mention it in SKILL.md's trust table.
- `timeAgo()` in popup.js already exists; reuse it.

## Later

- **Move a clip between collections.** Update clip is locked to the original collection today. Needs a file move, which the extension can't do through chrome.downloads; likely write to the new folder and mark the old one `status: superseded`, same as de-dupe.
- **Clean up stale filmstrip frames.** A re-inspect that takes fewer frames leaves older, higher-numbered frames on disk. The skill tells agents to trust the frame range in clip.md; a real fix needs a delete path (native helper or the agent-side skill).
- **Motion frame bursts.** Capture a short burst (e.g. 10 frames at 60ms) around each detected entrance, so agents can see the motion, not just read its timing.
- **Motion quality checks.** Flag jank (long frames during an animation), animations of layout properties, and missing `prefers-reduced-motion` handling.
- **Replica comparison.** Given a generated page, screenshot it at 1440×900 and diff it against the source clip's seen.jpg and timings.
- **Enrich step.** Optional agent pass that appends a `## Deep dive` (REA or similar) for clips with privately bundled GSAP or WebGL.
- **More over the agent bridge.** 0.8.0 lets an agent request clips (user-approved) through the MCP server. Next
  candidates: re-inspect a clip, and hold requests at the server while Chrome is closed instead of failing.
- **Chrome Web Store listing.** Prepared in STORE.md: needs the developer account, screenshots and promo tile at
  store sizes, and the reviewer screencast. Start unlisted.
- **Book that updates itself.** Today a book is a rebuild plus a push. A GitHub Action that rebuilds it when a
  synced library changes would make it hands-off.
- **A shelf of books.** One page listing books people have shared, so they can find each other's. Needs a home and
  some moderation; worth it once a few books exist.
- **Book covers with type.** The default cover is paint chips; a rendered cover with the title needs a headless
  browser, which agents often have. The skill could make one when it can.
- **Exact motion end states.** Plain CSS transitions and some sampled motion record timing but not where the
  element ends up, so the catalogue replays them with a generic move. Snapshot computed styles before and after
  each transition to record the real end state.
