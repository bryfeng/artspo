#!/usr/bin/env python3
"""Artspo MCP server: lets a coding agent read an Artspo library and ask the Artspo extension to clip pages.

    python3 artspo_mcp.py            # speaks MCP over stdio; your agent starts it

No dependencies (Python 3.9+ standard library). No hosted server, no account: this is a local process.

How it reaches the extension. Chrome extensions can't read files or accept connections, so the extension connects
*out* to this process on 127.0.0.1 (a WebSocket on port 47827, which the extension always uses; ARTSPO_PORT is only
for tests) and requests go back down that connection. Only connections whose Origin is a chrome-extension:// page are accepted as the extension
(pin one with ARTSPO_EXTENSION_ID), so ordinary web pages can't talk to it. When several agents run at once, the
first one to start holds the port and the others relay through it over a plain-TCP line protocol, which browsers
can't speak.

The library stays the source of truth. This server never writes clips: the extension does, as it always has.
Reads go straight to the files.
"""
import base64
import hashlib
import itertools
import json
import os
import re
import socket
import struct
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

VERSION = "0.8.0"
PORT = int(os.environ.get("ARTSPO_PORT") or 47827)
PINNED_EXTENSION = (os.environ.get("ARTSPO_EXTENSION_ID") or "").strip()
STATE_DIR = Path(os.environ.get("ARTSPO_HOME") or Path.home() / ".artspo")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 16 * 1024 * 1024
CALL_TIMEOUT = 20.0
PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")

NOT_CONNECTED = (
    "The Artspo extension isn't connected to this server. Ask the user to check three things: Chrome is open; "
    "Artspo is version 0.8.0 or newer (git pull, then reload it in chrome://extensions); and Artspo Setup -> "
    "Agents is set to 'Ask me first' or 'Clip without asking'. The extension looks for this server about once a "
    "minute, so wait a minute after any of those and try again. Reading the library (artspo_list_clips, artspo_read) "
    "works without the extension."
)


def log(*a):
    print("[artspo-mcp]", *a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- library on disk

def _state():
    try:
        return json.loads((STATE_DIR / "state.json").read_text())
    except Exception:
        return {}


def _save_state(**kw):
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        s = _state()
        s.update(kw)
        (STATE_DIR / "state.json").write_text(json.dumps(s, indent=2))
    except Exception as e:
        log("could not save state:", e)


def library_root():
    """ARTSPO_LIBRARY, else what the extension last reported, else ~/Downloads/artspo."""
    env = os.environ.get("ARTSPO_LIBRARY")
    if env:
        return Path(env).expanduser()
    known = _state().get("library")
    if known and Path(known).is_dir():
        return Path(known)
    return Path.home() / "Downloads" / "artspo"


TRACKING = re.compile(r"^(utm_\w+|ref|ref_src|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|mkt_tok|yclid|s_cid)$", re.I)


def norm_url(u):
    """Same rule as the extension's normUrl: www., trailing slash, #hash and tracking params don't make a new page."""
    try:
        x = urlsplit(str(u))
        host = (x.hostname or "").lower()
        host = host[4:] if host.startswith("www.") else host
        params = sorted((k, v) for k, v in parse_qsl(x.query, keep_blank_values=True) if not TRACKING.match(k))
        q = "?" + urlencode(params) if params else ""
        path = x.path.rstrip("/") or "/"
        path = re.sub(r"/index\.html?$", "", path, flags=re.I) or "/"
        return f"{host}{':' + str(x.port) if x.port else ''}{path}{q}"
    except Exception:
        return str(u or "")


def _frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    out = {}
    if not m:
        return out
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = v.strip()
        if v[:1] in ('"', "["):
            try:
                v = json.loads(v)
            except Exception:
                pass
        out[k.strip()] = v
    return out


def _note(text):
    m = re.search(r"^## Note\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    n = (m.group(1).strip() if m else "")
    return "" if n == "_(no note)_" else n


def list_clips(collection=None, url=None, limit=50):
    root = library_root()
    if not root.is_dir():
        return {"library": str(root), "error": f"No library folder at {root}. Set ARTSPO_LIBRARY, or clip something first."}
    want = norm_url(url) if url else None
    rows = []
    for md in root.glob("*/*/clip.md"):
        coll = md.parent.parent.name
        if collection and coll != collection:
            continue
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        fm = _frontmatter(text)
        if want and norm_url(fm.get("url", "")) != want:
            continue
        rows.append({
            "path": str(md.relative_to(root)),
            "url": fm.get("url"),
            "title": fm.get("title"),
            "collection": fm.get("collection") or coll,
            "status": fm.get("status"),
            "clipped": fm.get("clipped"),
            "inspected": fm.get("inspected"),
            "tags": fm.get("tags") or [],
            "note": _note(text)[:240],
        })
    rows.sort(key=lambda r: str(r.get("clipped") or ""), reverse=True)
    total = len(rows)
    return {"library": str(root), "total": total, "showing": min(total, limit), "clips": rows[: max(1, int(limit))]}


READABLE = {".md", ".txt", ".css", ".html", ".json", ".js", ".svg", ".csv", ".yml", ".yaml"}


def read_path(rel):
    root = library_root().resolve()
    target = (root / (rel or "")).resolve()
    if target != root and root not in target.parents:
        raise ValueError("That path is outside the Artspo library.")
    if not target.exists():
        raise ValueError(f"Nothing at {rel!r} in the library ({root}).")
    if target.is_dir():
        entries = []
        for p in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if p.name.startswith("."):
                continue
            entries.append(p.name + ("/" if p.is_dir() else ""))
        return {"library": str(root), "dir": str(target.relative_to(root)) if target != root else "", "entries": entries[:500]}
    if target.suffix.lower() not in READABLE:
        return {"library": str(root), "path": str(target.relative_to(root)), "note": "Binary file (image or similar); open it from disk.", "bytes": target.stat().st_size}
    data = target.read_bytes()[:400_000]
    return {"library": str(root), "path": str(target.relative_to(root)), "text": data.decode("utf-8", errors="replace")}


# ---------------------------------------------------------------- WebSocket (just enough of RFC 6455)

def ws_read(rf):
    """Read one message from a client (frames are masked). Returns (opcode, bytes) or None on EOF."""
    chunks, first_op = [], None
    while True:
        h = rf.read(2)
        if len(h) < 2:
            return None
        fin, op = h[0] & 0x80, h[0] & 0x0F
        masked, n = h[1] & 0x80, h[1] & 0x7F
        if n == 126:
            n = struct.unpack(">H", rf.read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", rf.read(8))[0]
        if n > MAX_FRAME:
            return None
        mask = rf.read(4) if masked else b""
        data = rf.read(n)
        if len(data) < n:
            return None
        if masked:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        if op >= 0x8:  # control frames are never fragmented
            return op, data
        if op != 0:
            first_op = op
        chunks.append(data)
        if fin:
            return first_op, b"".join(chunks)


def ws_frame(op, data):
    n = len(data)
    head = bytes([0x80 | op])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack(">H", n)
    else:
        head += bytes([127]) + struct.pack(">Q", n)
    return head + data


# ---------------------------------------------------------------- the link to the extension

class Pending:
    def __init__(self):
        self.ids = itertools.count(1)
        self.waiting = {}
        self.lock = threading.Lock()

    def open(self):
        ev = threading.Event()
        with self.lock:
            i = next(self.ids)
            self.waiting[i] = [ev, None]
        return i, ev

    def resolve(self, i, msg):
        with self.lock:
            slot = self.waiting.get(i)
        if slot:
            slot[1] = msg
            slot[0].set()

    def take(self, i):
        with self.lock:
            return self.waiting.pop(i, [None, None])[1]

    def fail_all(self, why):
        with self.lock:
            items = list(self.waiting.items())
        for i, slot in items:
            slot[1] = {"ok": False, "error": why}
            slot[0].set()


def _result(msg):
    if msg is None:
        raise TimeoutError("The Artspo extension didn't answer in time. It may be busy inspecting; try artspo_status in a moment.")
    if not msg.get("ok"):
        raise RuntimeError(msg.get("error") or "The extension reported an error.")
    return msg.get("result")


class Hub:
    """Holds the port. The extension connects here; other agents' servers relay through here."""

    def __init__(self, sock):
        self.sock = sock
        self.ext = None          # (conn, send_lock)
        self.ext_info = {}
        self.ext_lock = threading.Lock()
        self.pending = Pending()
        threading.Thread(target=self._accept, daemon=True).start()

    # -- calls from this process or from peers
    def info(self):
        with self.ext_lock:
            connected = self.ext is not None
        return {"connected": connected, **({"extension": self.ext_info} if connected else {})}

    def call(self, op, args, timeout=CALL_TIMEOUT):
        with self.ext_lock:
            ext = self.ext
        if not ext:
            raise ConnectionError(NOT_CONNECTED)
        i, ev = self.pending.open()
        conn, lock = ext
        payload = json.dumps({"id": i, "op": op, "args": args or {}}).encode()
        try:
            with lock:
                conn.sendall(ws_frame(0x1, payload))
        except OSError:
            self.pending.take(i)
            raise ConnectionError(NOT_CONNECTED)
        ev.wait(timeout)
        return _result(self.pending.take(i))

    # -- connections
    def _accept(self):
        while True:
            try:
                conn, addr = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        rf = conn.makefile("rb")
        try:
            first = rf.readline(8192)
            if first.startswith(b"GET "):
                self._websocket(conn, rf)
            elif first.strip():
                self._peer(conn, rf, first)
        except Exception as e:
            log("connection error:", e)
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def _websocket(self, conn, rf):
        headers = {}
        while True:
            line = rf.readline(8192)
            if not line or line in (b"\r\n", b"\n"):
                break
            k, _, v = line.decode("latin-1").partition(":")
            headers[k.strip().lower()] = v.strip()
        origin = headers.get("origin", "")
        ok_origin = origin.startswith("chrome-extension://") and (not PINNED_EXTENSION or origin == f"chrome-extension://{PINNED_EXTENSION}")
        if headers.get("upgrade", "").lower() != "websocket" or "sec-websocket-key" not in headers or not ok_origin:
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            if origin and not ok_origin:
                log("refused a connection from origin", origin)
            return
        accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + WS_GUID).encode()).digest()).decode()
        conn.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        lock = threading.Lock()
        me = (conn, lock)
        try:
            while True:
                got = ws_read(rf)
                if got is None:
                    break
                op, data = got
                if op == 0x8:
                    break
                if op == 0x9:
                    with lock:
                        conn.sendall(ws_frame(0xA, data))
                    continue
                if op != 0x1:
                    continue
                try:
                    msg = json.loads(data.decode("utf-8"))
                except ValueError:
                    continue
                if msg.get("type") == "hello":
                    with self.ext_lock:
                        old = self.ext
                        self.ext, self.ext_info = me, {k: v for k, v in msg.items() if k != "type"}
                    if old and old is not me:
                        try:
                            old[0].close()
                        except OSError:
                            pass
                    if msg.get("library"):
                        _save_state(library=msg["library"])
                    log(f"extension connected (Artspo {msg.get('version')}, {origin})")
                elif msg.get("type") == "ping":
                    with lock:
                        conn.sendall(ws_frame(0x1, b'{"type":"pong"}'))
                elif "id" in msg:
                    self.pending.resolve(msg["id"], msg)
        finally:
            with self.ext_lock:
                if self.ext is me:
                    self.ext, self.ext_info = None, {}
                    log("extension disconnected")
            self.pending.fail_all(NOT_CONNECTED)

    def _peer(self, conn, rf, first):
        try:
            hello = json.loads(first)
        except ValueError:
            return
        if hello.get("artspo") != "peer":
            return
        wlock = threading.Lock()

        def reply(obj):
            with wlock:
                conn.sendall((json.dumps(obj) + "\n").encode())

        def run(msg):
            rid = msg.get("id")
            try:
                if msg.get("op") == "_info":
                    reply({"id": rid, "ok": True, "result": self.info()})
                else:
                    reply({"id": rid, "ok": True, "result": self.call(msg["op"], msg.get("args"))})
            except Exception as e:
                reply({"id": rid, "ok": False, "error": str(e)})

        for line in rf:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            threading.Thread(target=run, args=(msg,), daemon=True).start()


class Peer:
    """Another agent's server holds the port; send requests through it."""

    def __init__(self, sock):
        self.sock = sock
        self.wlock = threading.Lock()
        self.pending = Pending()
        self.alive = True
        sock.sendall(b'{"artspo":"peer","version":"' + VERSION.encode() + b'"}\n')
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.sock.makefile("rb"):
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                self.pending.resolve(msg.get("id"), msg)
        except OSError:
            pass
        self.alive = False
        self.pending.fail_all("The Artspo server this one relayed through has stopped. Try again.")

    def _send(self, op, args, timeout):
        i, ev = self.pending.open()
        try:
            with self.wlock:
                self.sock.sendall((json.dumps({"id": i, "op": op, "args": args or {}}) + "\n").encode())
        except OSError:
            self.alive = False
            raise ConnectionError(NOT_CONNECTED)
        ev.wait(timeout)
        return _result(self.pending.take(i))

    def info(self):
        return self._send("_info", {}, 5.0)

    def call(self, op, args, timeout=CALL_TIMEOUT):
        return self._send(op, args, timeout + 2)


class Link:
    """Whichever role this process ends up in. Re-decides when a peer's hub goes away."""

    def __init__(self):
        self.impl = None
        self.lock = threading.Lock()

    def ensure(self):
        with self.lock:
            if isinstance(self.impl, Hub) or (isinstance(self.impl, Peer) and self.impl.alive):
                return self.impl
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                # reuse the port right after a previous server quit (TIME_WAIT); still fails if someone is listening
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", PORT))
                s.listen(16)
                self.impl = Hub(s)
                log(f"listening on 127.0.0.1:{PORT} for the Artspo extension")
            except OSError:
                try:
                    c = socket.create_connection(("127.0.0.1", PORT), timeout=3)
                    c.settimeout(None)
                    self.impl = Peer(c)
                    log(f"another Artspo server holds port {PORT}; relaying through it")
                except OSError as e:
                    self.impl = None
                    raise ConnectionError(f"Port {PORT} is taken by another program ({e}), and the Artspo extension always looks for this server on {PORT}. Find what's using it with: lsof -i :{PORT}")
            return self.impl

    def info(self):
        try:
            return self.ensure().info()
        except Exception as e:
            return {"connected": False, "error": str(e)}

    def call(self, op, args=None):
        return self.ensure().call(op, args or {})


LINK = Link()


# ---------------------------------------------------------------- tools

TOOLS = [
    {
        "name": "artspo_clip",
        "description": (
            "Ask the user's Artspo Chrome extension to clip web pages into their design library. Each page becomes "
            "<library>/<collection>/<date>_<site>_<id>/clip.md with its measured palette, type, shape and motion, "
            "plus screenshots. Inspection happens later in the user's own Chrome (when they're idle, or after "
            "artspo_process_now). Unless the user chose 'Clip without asking' in Artspo setup, they approve each "
            "request in the Artspo popup first, so tell them to look for it. Clip only pages the user asked for or "
            "agreed to, and never logged-in or private pages unless they explicitly asked. Pages already in the "
            "library are skipped, not duplicated."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "links": {
                    "type": "array", "minItems": 1, "maxItems": 25,
                    "description": "Pages to clip.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "http(s) URL of the page"},
                            "note": {"type": "string", "description": "Why this page: what to look at. Written as the clip's Note, which the skill treats as the user's intent, so keep it to what the user said or plainly wants."},
                        },
                        "required": ["url"],
                    },
                },
                "collection": {"type": "string", "description": "Collection (folder) to clip into, e.g. fintech-serious. Defaults to inbox. A new name creates the collection."},
            },
            "required": ["links"],
        },
    },
    {
        "name": "artspo_status",
        "description": "Whether the Artspo extension is connected, its approval setting, requests waiting for the user's approval, how many pages are queued or being inspected, and (given urls) where each of those pages stands: awaiting-approval, declined, queued, running, done, partial, failed or unknown, with its folder in the library.",
        "inputSchema": {
            "type": "object",
            "properties": {"urls": {"type": "array", "items": {"type": "string"}, "description": "Pages to look up."}},
        },
    },
    {
        "name": "artspo_process_now",
        "description": "Start inspecting queued pages now instead of waiting for the user to be idle. The extension opens each page in a background tab of the user's Chrome, and Chrome shows a 'started debugging this browser' bar while it works. Tell the user before calling this.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "artspo_list_clips",
        "description": "List clips in the Artspo library, newest first, from the clip.md files on disk: path, url, title, collection, status (queued, complete, partial, failed), dates, tags and the start of the user's note. Works without the extension.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "collection": {"type": "string", "description": "Only this collection."},
                "url": {"type": "string", "description": "Only the clip of this page."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 50},
            },
        },
    },
    {
        "name": "artspo_read",
        "description": "Read a text file in the Artspo library (clip.md, collection.md, AGENTS.md, patterns/INDEX.md, a pattern or work file), or list a folder. Paths are relative to the library root; an empty path lists the root. Read AGENTS.md first if you haven't worked with this library before: it explains the format and the rules. Works without the extension.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "e.g. AGENTS.md, inbox/2026-10-17_site_ab12/clip.md, patterns/INDEX.md, or a folder"}},
        },
    },
]

INSTRUCTIONS = (
    "Artspo is a design library of websites the user clipped, measured into plain files (clip.md per page). "
    "Read AGENTS.md in the library (artspo_read path 'AGENTS.md') before working with it. The user's Note in each "
    "clip outranks every measurement. Use artspo_clip only for pages the user wants; requests usually need their "
    "approval in the Artspo popup."
)


def tool_clip(args):
    links = args.get("links") or []
    if isinstance(links, str):
        links = [links]
    clean = []
    for item in links[:25]:
        if isinstance(item, str):
            item = {"url": item}
        url = str(item.get("url") or "").strip()
        if not re.match(r"^https?://", url, re.I):
            raise ValueError(f"Not an http(s) URL: {url!r}")
        clean.append({"url": url, "note": str(item.get("note") or "").replace("\n", " ").strip()})
    if not clean:
        raise ValueError("Give at least one link.")
    res = LINK.call("clip", {"links": clean, "collection": (args.get("collection") or "inbox").strip(), "client": CLIENT.get("name", "")})
    if res.get("state") == "awaiting-approval":
        res["next"] = ("The user needs to approve this in the Artspo popup (toolbar icon; the badge shows ?). Tell them. "
                       "Then check artspo_status with these urls; once queued, inspection runs when they're idle or after artspo_process_now.")
    else:
        res["next"] = "Queued. Inspection runs when the user is idle, or now via artspo_process_now. Check progress with artspo_status."
    return res


def tool_status(args):
    info = LINK.info()
    out = {"server": VERSION, "library": str(library_root()), **info}
    if info.get("connected"):
        res = LINK.call("status", {"urls": args.get("urls") or []})
        if res.get("library"):
            _save_state(library=res["library"])
        res.pop("library", None)
        out.update(res)
        out["library"] = str(library_root())
    elif "error" not in out:
        out["error"] = NOT_CONNECTED
    return out


def tool_process_now(_args):
    return LINK.call("processNow", {})


HANDLERS = {
    "artspo_clip": tool_clip,
    "artspo_status": tool_status,
    "artspo_process_now": tool_process_now,
    "artspo_list_clips": lambda a: list_clips(a.get("collection"), a.get("url"), a.get("limit") or 50),
    "artspo_read": lambda a: read_path(a.get("path") or ""),
}

CLIENT = {}


# ---------------------------------------------------------------- MCP over stdio

_out_lock = threading.Lock()


def send(obj):
    line = json.dumps(obj, ensure_ascii=False)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method is None:
        return  # a response to something we never send
    try:
        if method == "initialize":
            p = msg.get("params") or {}
            CLIENT.update(p.get("clientInfo") or {})
            asked = p.get("protocolVersion")
            result = {
                "protocolVersion": asked if asked in PROTOCOLS else PROTOCOLS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "artspo", "version": VERSION},
                "instructions": INSTRUCTIONS,
            }
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            p = msg.get("params") or {}
            fn = HANDLERS.get(p.get("name"))
            if not fn:
                raise KeyError(f"Unknown tool {p.get('name')!r}")
            try:
                data = fn(p.get("arguments") or {})
                result = {"content": [{"type": "text", "text": json.dumps(data, indent=2, ensure_ascii=False)}]}
            except Exception as e:  # tool errors go back to the model, not as protocol errors
                result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
        elif method.startswith("notifications/"):
            return
        else:
            if mid is not None:
                send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Method not found: {method}"}})
            return
        if mid is not None:
            send({"jsonrpc": "2.0", "id": mid, "result": result})
    except Exception as e:
        if mid is not None:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(e)}})


def main():
    if "--version" in sys.argv:
        print(VERSION)
        return
    log(f"Artspo MCP {VERSION}; library {library_root()}")
    try:
        LINK.ensure()  # take the port early so the extension can find us
    except Exception as e:
        log(e)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        # tool calls can wait on the extension; don't block the next message
        threading.Thread(target=handle, args=(msg,), daemon=True).start()
    time.sleep(0.2)  # let in-flight replies flush


if __name__ == "__main__":
    main()
