#!/bin/sh
# Installs the artspo skill for every coding agent found on this Mac (Claude Code, Codex, Cursor, Gemini CLI, Copilot).
#
#   No clone needed:   curl -fsSL https://raw.githubusercontent.com/bryfeng/artspo/main/install.sh | sh
#   From a clone:      sh install.sh
#
# Re-running it is how you update the skill. Restart your agent afterwards.
set -e
here="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
SRC="$here/extension/skills/artspo"
if [ ! -f "$SRC/SKILL.md" ]; then
  # run through curl | sh, or from somewhere else: fetch the latest skill from GitHub
  command -v curl >/dev/null 2>&1 || { echo "Needs curl. Or clone https://github.com/bryfeng/artspo and run sh install.sh there."; exit 1; }
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading the artspo skill from github.com/bryfeng/artspo…"
  curl -fsSL https://codeload.github.com/bryfeng/artspo/tar.gz/refs/heads/main | tar -xz -C "$tmp"
  SRC="$tmp/artspo-main/extension/skills/artspo"
  [ -f "$SRC/SKILL.md" ] || { echo "Download didn't contain the skill. Try again, or clone the repo."; exit 1; }
fi
installed=0
for dir in "$HOME/.claude" "$HOME/.agents" "$HOME/.cursor" "$HOME/.gemini" "$HOME/.copilot"; do
  case "$dir" in
    */.agents) ;;                      # shared location (Codex reads it, and others); always install
    *) [ -d "$dir" ] || continue ;;    # agent-specific: only if that agent is installed
  esac
  mkdir -p "$dir/skills"
  rm -rf "$dir/skills/artspo"
  cp -R "$SRC" "$dir/skills/artspo"
  find "$dir/skills/artspo" -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
  echo "installed → $dir/skills/artspo"
  installed=$((installed + 1))
done
version="$(sed -n 's/^.*Skill version \([0-9][0-9.]*[0-9]\).*$/\1/p' "$SRC/SKILL.md" | head -1)"
command -v python3 >/dev/null 2>&1 || echo "note: python3 not found. Agents need it to build the catalogue and books (run: xcode-select --install)."
echo "done: artspo skill ${version:+$version }in $installed locations. Restart your agent so it picks up the skill."
