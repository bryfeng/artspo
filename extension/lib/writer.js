// Writes files into ~/Downloads/artspo/... via chrome.downloads, without a native host.
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

function waitForDownload(id, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const done = (ok, err) => { chrome.downloads.onChanged.removeListener(listener); clearTimeout(timer); ok ? resolve() : reject(new Error(err)); };
    const listener = (d) => {
      if (d.id !== id || !d.state) return;
      if (d.state.current === 'complete') done(true);
      else if (d.state.current === 'interrupted') done(false, `download interrupted (${d.error?.current || 'unknown'})`);
    };
    const timer = setTimeout(() => done(false, 'download timed out'), timeoutMs);
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id }).then(([d]) => {
      if (d?.state === 'complete') done(true);
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

// files: [{ path: 'artspo/inbox/2026-10-14_site_ab12/clip.md', text } | { path, base64, mime }]
export async function writeFiles(files) {
  await ensureOffscreen();
  await setQuiet(true);
  const written = [];
  try {
    for (const f of files) {
      const mime = f.mime || (f.path.endsWith('.md') ? 'text/markdown' : 'application/octet-stream');
      const url = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob', mime, text: f.text, base64: f.base64 });
      const id = await chrome.downloads.download({ url, filename: f.path, conflictAction: 'overwrite', saveAs: false });
      try {
        await waitForDownload(id);
        const [item] = await chrome.downloads.search({ id });
        written.push(item?.filename || f.path);
      } finally {
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
        chrome.downloads.erase({ id }).catch(() => {});
      }
    }
  } finally {
    await setQuiet(false);
  }
  return written; // absolute paths on disk
}
