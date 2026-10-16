#!/bin/sh
# Installs the artspo skill for every coding agent found on this machine.
# Usage: sh install.sh        (from the repo root; safe to re-run after updating)
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/extension/skills/artspo"
[ -f "$SRC/SKILL.md" ] || { echo "Can't find $SRC/SKILL.md. Run this from the Artspo repo root."; exit 1; }
installed=0
for dir in "$HOME/.claude" "$HOME/.agents" "$HOME/.cursor" "$HOME/.gemini" "$HOME/.copilot"; do
  case "$dir" in
    */.agents) ;;                      # shared location (Codex and others); always install
    *) [ -d "$dir" ] || continue ;;    # agent-specific: only if that agent is installed
  esac
  mkdir -p "$dir/skills"
  rm -rf "$dir/skills/artspo"
  cp -R "$SRC" "$dir/skills/artspo"
  find "$dir/skills/artspo" -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
  echo "installed → $dir/skills/artspo"
  installed=$((installed + 1))
done
command -v python3 >/dev/null 2>&1 || echo "note: python3 not found. Agents need it to build the catalogue page (everything else works without it)."
echo "done ($installed locations). Restart your agent so it picks up the skill."
