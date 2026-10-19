// Just enough of the chrome.* API to run Artspo's real background.js in Node.
// "Downloads" are written under DOWNLOADS so the MCP server can read them back from disk.
import fs from 'node:fs';
import path from 'node:path';

export function installFakeChrome({ extRoot, downloads, origin }) {
  const store = new Map();
  const listeners = { message: [], alarm: [], dl: [], installed: [], startup: [], idle: [] };
  const blobs = new Map();
  const dls = new Map();
  let dlId = 0, blobId = 0;
  const badge = { text: '', color: '' };
  const manifest = JSON.parse(fs.readFileSync(path.join(extRoot, 'manifest.json'), 'utf8'));

  const chrome = {
    storage: { local: {
      get: async (k) => (store.has(k) ? { [k]: structuredClone(store.get(k)) } : {}),
      set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
    } },
    runtime: {
      getManifest: () => manifest,
      getURL: (p) => 'chrome-extension://test/' + p,
      getPlatformInfo: async () => ({}),
      getContexts: async () => [{}],
      onInstalled: { addListener: (f) => listeners.installed.push(f) },
      onStartup: { addListener: (f) => listeners.startup.push(f) },
      onMessage: { addListener: (f) => listeners.message.push(f) },
      sendMessage: async (msg) => {
        if (msg?.target === 'offscreen' && msg.type === 'blob') {
          const id = 'blob:' + ++blobId;
          blobs.set(id, msg.text != null ? Buffer.from(msg.text, 'utf8') : Buffer.from(msg.base64 || '', 'base64'));
          return id;
        }
        return undefined; // popup not open
      },
      openOptionsPage: () => {},
    },
    offscreen: { createDocument: async () => {} },
    downloads: {
      download: async ({ url, filename }) => {
        const abs = path.join(downloads, filename);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, blobs.get(url));
        const id = ++dlId;
        dls.set(id, { id, state: 'complete', filename: abs });
        return id;
      },
      search: async ({ id }) => (dls.has(id) ? [dls.get(id)] : []),
      onChanged: { addListener: (f) => listeners.dl.push(f), removeListener: () => {} },
      erase: async () => {},
      setUiOptions: async () => {},
      showDefaultFolder: () => {},
    },
    idle: { setDetectionInterval: () => {}, onStateChanged: { addListener: (f) => listeners.idle.push(f) }, queryState: async () => 'active' },
    alarms: { create: () => {}, clear: async () => true, onAlarm: { addListener: (f) => listeners.alarm.push(f) } },
    action: { setBadgeText: ({ text }) => { badge.text = text; }, setBadgeBackgroundColor: ({ color }) => { badge.color = color; } },
    tabs: { captureVisibleTab: async () => { throw new Error('no tab'); }, create: async () => ({}), query: async () => [] },
  };
  globalThis.chrome = chrome;

  // the real extension's WebSocket sends Origin: chrome-extension://<id>; Node's needs it set explicitly
  const NodeWS = globalThis.WebSocket;
  globalThis.WebSocket = class extends NodeWS { constructor(url) { super(url, { headers: { Origin: origin } }); } };

  // what the popup does: chrome.runtime.sendMessage({target:'background', ...})
  const popup = (type, extra = {}) => new Promise((resolve) => {
    const msg = { target: 'background', type, ...extra };
    for (const f of listeners.message) f(msg, {}, resolve);
  });
  const fireAlarm = (name) => listeners.alarm.forEach((f) => f({ name }));
  return { chrome, store, badge, popup, fireAlarm };
}
