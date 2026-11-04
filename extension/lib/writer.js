// Writes files into the library folder under Downloads (artspo/ by default) via chrome.downloads, without a native host.
// Downloads are hidden from the shelf/bubble while writing and erased from history afterwards
// (erasing history does not delete the file).

const OFFSCREEN = 'offscreen/offscreen.html';
let creating;

async function ensureOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctx.length) return;
  }
  creating ||= chrome.offscreen
    .createDocument({ url: OFFSCREEN, reasons: ['BLOBS'], justification: 'Create blob URLs so clip files can be saved' })
    .catch((e) => { if (!/single offscreen|already/i.test(String(e?.message))) throw e; })
    .finally(() => { creating = null; });
  await creating;
}

// a download Chrome holds for a "keep or discard?" warning never finishes on its own: give up on it at once
const FLAGGED = (danger) => danger && danger !== 'safe' && danger !== 'accepted';

function waitForDownload(id, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(listener); clearTimeout(timer);
      if (ok) resolve(); else { if (/flagged/.test(err)) chrome.downloads.cancel(id).catch(() => {}); reject(new Error(err)); }
    };
    const listener = (d) => {
      if (d.id !== id) return;
      if (FLAGGED(d.danger?.current)) return done(false, `Chrome flagged the download (${d.danger.current})`);
      if (!d.state) return;
      if (d.state.current === 'complete') done(true);
      else if (d.state.current === 'interrupted') done(false, `download interrupted (${d.error?.current || 'unknown'})`);
    };
    const timer = setTimeout(() => done(false, 'download timed out'), timeoutMs);
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id }).then(([d]) => {
      if (FLAGGED(d?.danger)) done(false, `Chrome flagged the download (${d.danger})`);
      else if (d?.state === 'complete') done(true);
      else if (d?.state === 'interrupted') done(false, `download interrupted (${d.error})`);
    });
  });
}

let quiet = 0;
async function setQuiet(on) {
  if (!chrome.downloads.setUiOptions) return;
  quiet += on ? 1 : -1;
  try { await chrome.downloads.setUiOptions({ enabled: quiet <= 0 }); } catch {}
}

async function writeOne(f, timeoutMs) {
  const mime = f.mime || (f.path.endsWith('.md') ? 'text/markdown' : 'application/octet-stream');
  const url = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob', mime, text: f.text, base64: f.base64 });
  const id = await chrome.downloads.download({ url, filename: f.path, conflictAction: 'overwrite', saveAs: false });
  try {
    await waitForDownload(id, timeoutMs);
    const [item] = await chrome.downloads.search({ id });
    return item?.filename || f.path;
  } finally {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
    chrome.downloads.erase({ id }).catch(() => {});
  }
}

// files: [{ path: 'artspo/inbox/2026-10-14_site_ab12/clip.md', text } | { path, base64, mime }]
export async function writeFiles(files) {
  await ensureOffscreen();
  await setQuiet(true);
  const written = [];
  try {
    for (const f of files) written.push(await writeOne(f, 60000));
  } finally {
    await setQuiet(false);
  }
  return written; // absolute paths on disk
}

// Same, but one file that won't write doesn't stop the rest. Returns { ok: [path], failed: [{ path, error }] }.
export async function writeFilesBestEffort(files) {
  await ensureOffscreen();
  await setQuiet(true);
  const ok = [], failed = [];
  try {
    for (const f of files) {
      try { await writeOne(f, 20000); ok.push(f.path); } catch (e) { failed.push({ path: f.path, error: String(e?.message || e) }); }
    }
  } finally {
    await setQuiet(false);
  }
  return { ok, failed };
}
