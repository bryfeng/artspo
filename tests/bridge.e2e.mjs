// End-to-end: real MCP server (python) <-> real background.js (with fake chrome) over the real bridge.
// Usage: node tests/bridge.e2e.mjs   (needs Node 22+ and python3; uses port 47827, so quit any agent running the Artspo MCP server first)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import { installFakeChrome } from './fake-chrome.mjs';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'artspo-e2e-'));
fs.rmSync(work, { recursive: true, force: true });
const HOME = path.join(work, 'home');
const DOWNLOADS = path.join(HOME, 'Downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (name) => { passed++; console.log('  ok', name); };

// ---- an MCP client over stdio
function startServer(label) {
  const p = spawn('python3', [path.join(repo, 'mcp/artspo_mcp.py')], {
    env: { ...process.env, HOME, ARTSPO_HOME: path.join(HOME, '.artspo') }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map();
  let buf = '', next = 1;
  const logs = [];
  p.stderr.on('data', (d) => logs.push(...String(d).trim().split('\n').map((l) => `${label}: ${l}`)));
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error(`${label} ${method} timed out`)), 30000);
  });
  const tool = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.result.content[0].text;
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.result.isError, data, text };
  };
  return { p, rpc, tool, logs, kill: () => p.kill() };
}

// ---- 1. server up, nothing connected
const A = startServer('A');
const init = await A.rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', version: 'test' }, capabilities: {} });
assert.equal(init.result.serverInfo.name, 'artspo');
assert.equal(init.result.protocolVersion, '2025-06-18');
A.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const list = await A.rpc('tools/list', {});
assert.deepEqual(list.result.tools.map((t) => t.name), ['artspo_clip', 'artspo_status', 'artspo_process_now', 'artspo_list_clips', 'artspo_read']);
ok('initialize + tools/list');
const old = await A.rpc('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'old' }, capabilities: {} });
assert.equal(old.result.protocolVersion, '2024-11-05');
const future = await A.rpc('initialize', { protocolVersion: '2099-01-01', clientInfo: { name: 'claude-code' }, capabilities: {} });
assert.equal(future.result.protocolVersion, '2025-06-18');
ok('older protocol version is echoed back; an unknown one gets the newest we speak');

let st = await A.tool('artspo_status');
assert.equal(st.data.connected, false);
assert.match(st.data.error, /isn't connected/);
let clipErr = await A.tool('artspo_clip', { links: [{ url: 'https://canvasui.dev/docs/components/liquid' }] });
assert.equal(clipErr.isError, true);
assert.match(clipErr.text, /isn't connected/);
ok('clear errors before the extension connects');

// ---- 2. a web page can't pose as the extension
const refused = await new Promise((resolve) => {
  const s = net.connect(47827, '127.0.0.1', () => s.write('GET /artspo HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: https://evil.example\r\n\r\n'));
  s.on('data', (d) => { resolve(String(d).split('\r\n')[0]); s.destroy(); });
});
assert.match(refused, /403/);
ok('WebSocket from a web origin is refused (403)');

// ---- 3. the extension (real background.js) connects
const fake = installFakeChrome({ extRoot: path.join(repo, 'extension'), downloads: DOWNLOADS, origin: 'chrome-extension://abcdefghijklmnop' });
await import(path.join(repo, 'extension/background.js'));
for (let i = 0; i < 50 && !(await A.tool('artspo_status')).data.connected; i++) await sleep(100);
st = await A.tool('artspo_status');
assert.equal(st.data.connected, true);
assert.equal(st.data.extension.version, JSON.parse(fs.readFileSync(path.join(repo, 'extension/manifest.json'), 'utf8')).version);
assert.equal(st.data.approval, 'ask');
ok('extension connects on startup and says hello (its version, approval: ask)');

// ---- 4. clip asks first
const links = [
  { url: 'https://canvasui.dev/docs/components/liquid?utm_source=x', note: 'WebGL fluid over live HTML; does motion capture see it?' },
  { url: 'https://uselayouts.com/docs/components/discrete-tabs', note: 'Motion springs: check what clip.md records' },
];
let res = await A.tool('artspo_clip', { links, collection: 'Agent Ready Tests' });
assert.equal(res.isError, false, res.text);
assert.equal(res.data.state, 'awaiting-approval');
assert.equal(res.data.collection, 'agent-ready-tests');
assert.equal(fake.badge.text, '?');
const urls = links.map((l) => l.url);
st = await A.tool('artspo_status', { urls });
assert.deepEqual(st.data.items.map((i) => i.state), ['awaiting-approval', 'awaiting-approval']);
assert.equal(st.data.awaitingApproval.length, 1);
assert.equal(fs.existsSync(path.join(DOWNLOADS, 'artspo/agent-ready-tests')), false, 'nothing written before approval');
ok('clip request waits for approval; badge shows ?; nothing written yet');

const state = await fake.popup('state');
assert.equal(state.requests.length, 1);
assert.equal(state.requests[0].client, 'claude-code');
assert.equal(state.bridge.connected, true);
const appr = await fake.popup('approveRequest', { id: state.requests[0].id });
assert.equal(appr.added.length, 2, JSON.stringify(appr));
st = await A.tool('artspo_status', { urls });
assert.deepEqual(st.data.items.map((i) => i.state), ['queued', 'queued']);
assert.ok(st.data.items[0].path.startsWith(path.join(DOWNLOADS, 'artspo/agent-ready-tests/')), st.data.items[0].path);
assert.equal(st.data.library, path.join(DOWNLOADS, 'artspo'));
assert.equal(fake.badge.text, '2');
ok('approve in the popup queues both; status gives their folders and the library path');

const coll = fs.readFileSync(path.join(DOWNLOADS, 'artspo/agent-ready-tests/collection.md'), 'utf8');
assert.match(coll, /canvasui\.dev\/docs\/components\/liquid — WebGL fluid/);
assert.doesNotMatch(coll, /utm_source/);
ok('collection.md lists the links with their notes (tracking params stripped)');

// ---- 5. duplicates, decline, auto mode
res = await A.tool('artspo_clip', { links: [{ url: 'https://www.canvasui.dev/docs/components/liquid/' }] });
assert.equal(res.data.state, 'nothing-new');
assert.equal(res.data.already[0].collection, 'agent-ready-tests');
ok('a page already in the library is not clipped twice');

res = await A.tool('artspo_clip', { links: [{ url: 'https://example.com/private' }], collection: 'inbox' });
const req2 = (await fake.popup('state')).requests[0];
await fake.popup('declineRequest', { id: req2.id });
st = await A.tool('artspo_status', { urls: ['https://example.com/private'] });
assert.equal(st.data.items[0].state, 'declined');
assert.equal(fake.badge.text, '2');
ok('decline: nothing queued, status says declined');

await fake.popup('settings', { settings: { agents: 'auto' } });
res = await A.tool('artspo_clip', { links: [{ url: 'https://designeer.xyz/', note: 'curation site, agent-facing llms.txt' }], collection: 'agent-ready-tests' });
assert.equal(res.data.state, 'queued');
assert.equal(res.data.added.length, 1);
ok('"Clip without asking" queues straight away');

const bad = await A.tool('artspo_clip', { links: [{ url: 'javascript:alert(1)' }] });
assert.equal(bad.isError, true);
ok('non-http links are rejected');

// ---- 6. reading the library from disk
const lc = await A.tool('artspo_list_clips', { collection: 'agent-ready-tests' });
assert.equal(lc.data.total, 3);
assert.equal(lc.data.clips.every((c) => c.status === 'queued'), true);
assert.ok(lc.data.clips.some((c) => /WebGL fluid/.test(c.note)));
const one = await A.tool('artspo_list_clips', { url: 'https://uselayouts.com/docs/components/discrete-tabs/' });
assert.equal(one.data.total, 1);
const clipmd = await A.tool('artspo_read', { path: one.data.clips[0].path });
assert.match(clipmd.data.text, /status: queued/);
const root = await A.tool('artspo_read', { path: '' });
assert.ok(root.data.entries.includes('agent-ready-tests/'));
const esc = await A.tool('artspo_read', { path: '../../.ssh/id_rsa' });
assert.equal(esc.isError, true);
assert.match(esc.text, /outside the Artspo library/);
ok('list_clips/read work from disk, find by URL, and refuse paths outside the library');

// ---- 7. a second agent relays through the first
const B = startServer('B');
await B.rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'codex' }, capabilities: {} });
st = await B.tool('artspo_status', { urls });
assert.equal(st.data.connected, true, JSON.stringify(st.data));
assert.equal(st.data.items[0].state, 'queued');
res = await B.tool('artspo_clip', { links: [{ url: 'https://artbook.dev/' }], collection: 'inbox' });
assert.equal(res.data.state, 'queued');
assert.ok(B.logs.some((l) => /relaying/.test(l)), B.logs.join('\n'));
ok('a second agent\'s server relays through the first');

// ---- 8. the first agent quits: the second takes over the port, the extension reconnects
A.kill();
await sleep(300);
st = await B.tool('artspo_status');
assert.equal(st.data.connected, false); // took the port, extension not back yet
fake.fireAlarm('artspo-bridge');       // the extension's once-a-minute look
for (let i = 0; i < 50 && !(await B.tool('artspo_status')).data.connected; i++) await sleep(100);
st = await B.tool('artspo_status');
assert.equal(st.data.connected, true);
ok('when the first agent quits, the second takes over and the extension reconnects on its next check');

// ---- 9. off means off
await fake.popup('settings', { settings: { agents: 'off' } });
await sleep(300);
st = await B.tool('artspo_status');
assert.equal(st.data.connected, false);
fake.fireAlarm('artspo-bridge');
await sleep(300);
assert.equal((await B.tool('artspo_status')).data.connected, false);
const stillReads = await B.tool('artspo_list_clips', {});
assert.equal(stillReads.data.total, 4);
ok('"Off" disconnects and stays off; reading the library still works');

console.log(`\n${passed} checks passed`);
B.kill();
fs.rmSync(work, { recursive: true, force: true });
process.exit(0);
