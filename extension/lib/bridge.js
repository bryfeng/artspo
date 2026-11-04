// The agent bridge: a WebSocket out to the Artspo MCP server running on this computer (mcp/artspo_mcp.py),
// so a coding agent can ask Artspo to clip pages. The extension always dials out: extensions can't accept
// connections, and a local web page can't pretend to be the extension because the server checks the Origin.
//
// No server running is the normal case, so failures are quiet. While connected, a ping every 20s keeps the
// service worker awake (Chrome 116+ counts WebSocket traffic); otherwise an alarm looks again every minute.

export const BRIDGE_PORT = 47827;
const ALARM = 'artspo-bridge';
let ws = null;
let keepAlive = null;
let handlers = null;
let lastChange = null;

export function startBridge(h) {
  handlers = h;
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  connect();
}

export function stopBridge() {
  chrome.alarms.clear(ALARM);
  if (ws) { try { ws.close(); } catch {} }
  ws = null;
}

export function onBridgeAlarm(a) {
  if (a.name === ALARM && handlers) connect();
}

export const bridgeState = () => ({ connected: !!ws && ws.readyState === 1, since: lastChange });

async function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  if (!(await handlers.enabled())) return;
  let sock;
  try { sock = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}/artspo`); } catch { return; }
  ws = sock;
  let opened = false;
  const send = (obj) => { if (sock.readyState === 1) sock.send(JSON.stringify(obj)); };
  sock.onopen = async () => {
    opened = true;
    lastChange = Date.now();
    send({ type: 'hello', app: 'artspo', ...(await handlers.hello()) });
    clearInterval(keepAlive);
    keepAlive = setInterval(() => send({ type: 'ping' }), 20000);
    handlers.changed?.();
  };
  sock.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || msg.id == null || !msg.op) return;
    try {
      send({ id: msg.id, ok: true, result: await handlers.op(msg.op, msg.args || {}) });
    } catch (err) {
      send({ id: msg.id, ok: false, error: String(err?.message || err) });
    }
  };
  sock.onerror = () => {}; // no server listening: expected, stay quiet
  sock.onclose = () => {
    if (ws === sock) ws = null;
    clearInterval(keepAlive);
    keepAlive = null;
    if (opened) { lastChange = Date.now(); handlers.changed?.(); }
  };
}
