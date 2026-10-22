#!/usr/bin/env bash
# Install these skills for your user so they are available in every repo (Claude Code: ~/.claude/skills).
# Usage: ./install.sh            copy (re-run to update)
#        ./install.sh --check    show what is installed
set -e
SRC="$(cd "$(dirname "$0")/.claude/skills" && pwd)"
DST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
if [ "$1" = "--check" ]; then
  for s in "$SRC"/*/; do n=$(basename "$s"); [ -f "$DST/$n/SKILL.md" ] && echo "installed: $n" || echo "missing:   $n"; done; exit 0
fi
mkdir -p "$DST"
for s in "$SRC"/*/; do n=$(basename "$s"); rm -rf "$DST/$n"; cp -r "$s" "$DST/$n"; echo "installed $n -> $DST/$n"; done
echo "Done. Start Claude Code and say e.g. 'use repo-builder to start a new Next.js project called X'."
