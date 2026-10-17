# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste. Upload `dist/artspo-extension-<version>.zip` from
`sh package.sh`.

## Store listing

**Name:** Artspo

**Summary** (from the manifest, 132 characters max):
Save websites as design inspiration. Measures colors, fonts, design tokens and motion into files your AI coding agent builds from.

**Category:** Developer Tools (its scope includes CSS inspection; Art & Design is the runner-up)

**Language:** English

**Description:**

> Artspo turns websites you like into a design library your coding agent can build from.
>
> Press Alt+Shift+S on any site and write one line about what caught your eye. While you're away, Artspo opens the
> page in a background tab, scrolls it, and measures what it's made of: the palette by share of the page, the type
> scale, radii, shadows, buttons, and every animation with its duration, easing, delay and stagger. Screenshots
> can't show motion; Artspo records it.
>
> Each clip becomes a folder with a clip.md file in your Downloads folder. Claude Code, Codex, Cursor or any agent
> that reads files can then find the design languages and techniques your clips share, and make brand directions,
> tokens, motion specs and pages from them. A free agent skill (github.com/bryfeng/artspo) teaches agents the
> format, builds a browsable catalogue, and publishes your library as a shareable book with copyable prompts.
>
> Private by design: no account, no server, no analytics. Nothing leaves your computer.
>
> Made for macOS. Open source under the MIT license.

**Assets:**
- Icon: `extension/icons/icon128.png`
- Screenshots (1280×800): the popup over a site, a clip's elements rebuilt, the motion timeline, the catalogue,
  a book with a prompt open. Re-crop from `docs/media/`.
- Small promo tile (440×280): the logo on the conic gradient, with "Clip the web's best design."

**Homepage:** https://artbook.dev/?utm_source=chrome-web-store&utm_medium=listing&utm_campaign=artspo
**Support:** https://github.com/bryfeng/artspo/issues

**Visibility:** start **Unlisted**. Switch to Public once it has run well for a while.

**Listing rules worth knowing:** keep any one keyword under 5 uses and name no more than 5 brands or sites in the
description (the store's spam policy). The description already names Claude Code, Codex and Cursor; don't add a list
of agents. Links to the listing from outside should carry `utm_source`/`utm_medium`/`utm_campaign`: the dashboard
breaks listing views down by them.

## Privacy practices

**Single purpose:**
Save websites the user chooses as design references: measure their colors, type, layout and motion, and write
them as local files an AI coding agent can read.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `debugger` | Inspects only pages the user clipped, in a tab Artspo opens itself for that purpose. Uses the DevTools Protocol to set a fixed 1440×900 viewport, inject Artspo's packaged motion recorder before the page's scripts run (so animations that play on load are recorded), scroll with real wheel input (so scroll-triggered motion fires), and take full-page screenshots. It detaches when the inspection ends and never attaches to the user's own tabs. Nothing is sent anywhere. |
| Host permission (all sites) | The user can clip any site. Artspo needs to read the clipped page, screenshot the visible tab when the user clips it, and open that same URL later for inspection. It only touches pages the user clipped. |
| `downloads` | Writes the library (clip.md files and screenshots) into a folder inside the user's Downloads folder. This is the only way an extension can write files the user's tools can read. |
| `downloads.ui` | Hides the download bubble while a clip's files are written, so saving one clip doesn't flash about 15 downloads. |
| `offscreen` | Creates blob URLs for the files being written (service workers can't). |
| `storage` | Remembers the user's clips, collections, inspection queue and settings. |
| `idle` | Runs inspections when the user is away, so they don't interrupt browsing. |
| `alarms` | Checks the inspection queue periodically. |

**Remote code:** No. All code, including the scripts injected during inspection, is packaged in the extension.

**Data usage:** Artspo doesn't transmit any user data off the device, so under the store's definition it collects
none. Leave the boxes unticked and certify the three statements. (If the form makes you unsure, ticking "Website
content" with the note "stored locally in the user's Downloads folder, never transmitted" is the conservative
choice.)

**Privacy policy:** https://github.com/bryfeng/artspo/blob/main/docs/PRIVACY.md

## Notes for the reviewer

Paste into the "notes" field if the dashboard offers one, or keep for a reply if review asks:

> Artspo is a design-reference clipper. When the user clips a page (toolbar button or Alt+Shift+S), it saves a
> screenshot of the visible tab. When the user is idle, it opens the clipped URL in a separate background tab that
> it creates, attaches chrome.debugger to that tab only, scrolls and measures it, writes the results as files to
> the Downloads folder, detaches and closes the tab. The extension has no server. Its only network requests are
> the clipped page itself and that page's stylesheets, fetched to read its animation keyframes; nothing is sent
> anywhere. Source: https://github.com/bryfeng/artspo. A 60-second screencast of one inspection: <link>.

**Screencast to record:** clip a site with the popup, press **Process now**, show the background tab opening and
closing, then open the clip's folder and its `clip.md`.

## Each update

1. Bump `version` in `extension/manifest.json` and the "Skill version" line in `extension/skills/artspo/SKILL.md`
   (`package.sh` refuses to build if they differ).
2. Push to main. The release workflow publishes GitHub Release v<version> with both zips (and
   `.github/release-notes/v<version>.md` as its notes, if you wrote one).
3. Upload `artspo-extension-<version>.zip` from that release (or `sh package.sh`) to the store, submit.
4. Installed copies update on their own. The skill doesn't: agents tell the user when theirs is older than the
   extension, and the install one-liner updates it.
