# Let your agent clip: the Artspo MCP server

`mcp/artspo_mcp.py` is a small MCP server that lets a coding agent read your Artspo library and ask the extension
to clip pages. It runs on your computer: your agent starts it and stops it. There's no hosted server and no account,
and it needs only Python 3 (on a Mac, anyone with git has it).

> Find five fintech landing pages with great motion and clip them into fintech-serious.

## Set it up

**Claude Code.** The plugin includes the server and starts it for you:

```
/plugin install artspo --marketplace bryfeng/artspo
```

Without the plugin, run `sh install.sh` (it copies the server to `~/.artspo/mcp/artspo_mcp.py`), then:

```sh
claude mcp add --scope user artspo -- python3 ~/.artspo/mcp/artspo_mcp.py
```

**Codex.** In `~/.codex/config.toml`:

```toml
[mcp_servers.artspo]
command = "python3"
args = ["/Users/<you>/.artspo/mcp/artspo_mcp.py"]
```

**Anything else** (Cursor, Claude Desktop, Gemini CLI…): add a stdio server with command `python3` and argument
`~/.artspo/mcp/artspo_mcp.py` (write the full path if the app doesn't expand `~`).

**In Chrome:** Artspo 0.8.0 or newer. Setup → *Let your agent clip pages* is **Ask me first** by default.

## What the agent gets

| Tool | What it does | Needs the extension |
|---|---|---|
| `artspo_clip` | Asks Artspo to clip up to 25 pages into a collection, each with an optional note | yes |
| `artspo_status` | Connection, approval setting, requests waiting for you, and where given pages stand | yes |
| `artspo_process_now` | Starts inspecting queued pages now instead of when you're idle | yes |
| `artspo_list_clips` | Lists clips from the `clip.md` files on disk | no |
| `artspo_read` | Reads a file in the library, or lists a folder | no |

## Approving requests

Clipping loads pages in your real Chrome profile, logged-in sessions included. So by default an agent can only
ask: the request waits in the Artspo popup, with the badge showing **?**, until you click **Approve** or
**Decline**. Nothing is written or queued before that. In Setup you can choose:

- **Ask me first** (default): every request waits for you.
- **Clip without asking**: requests are queued straight away, like pasting links into a collection.
- **Off**: the extension stops looking for the server. Agents can still read your library files.

## How it connects

Chrome extensions can't read files from disk or accept connections, so the extension connects *out*: a
WebSocket to `127.0.0.1:47827`, where the server listens. Requests come back down that connection, and the
extension does what it always does: it writes the clips. The server only reads files, and never writes clips.

- **Only the extension gets in.** The server accepts a WebSocket only when its Origin is a `chrome-extension://`
  page, so websites you visit can't talk to it. To accept just your copy of Artspo, set `ARTSPO_EXTENSION_ID` to
  the ID shown in `chrome://extensions`.
- **Several agents at once.** The first server to start holds the port; the others relay through it. If the first
  one quits, the next request from another takes the port over.
- **When it connects.** While Chrome is open, the extension looks for the server about once a minute, and stays
  connected while the server runs. If your agent says Artspo isn't connected, wait a minute.
- **Where the library is.** The extension tells the server, and the server remembers it in `~/.artspo/state.json`.
  Set `ARTSPO_LIBRARY` to override it.

## Troubleshooting

- **"The Artspo extension isn't connected."** Check that Chrome is open, Artspo is 0.8.0 or newer (`git pull`,
  then ↻ on Artspo in `chrome://extensions`), and Setup isn't set to Off. Then wait a minute.
- **"Port 47827 is taken by another program."** Something else is using the port. `lsof -i :47827` shows what.
- **Logs.** The server writes to stderr, which your agent keeps in its MCP logs (in Claude Code, `/mcp`).
