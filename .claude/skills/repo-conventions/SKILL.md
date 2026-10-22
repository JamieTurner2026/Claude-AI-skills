---
name: repo-conventions
description: Apply the user's standard repo conventions to a new or existing repository - a CLAUDE.md (commands, structure, style, secret-handling rules), a pull-request template, and commit rules. Use when starting a repo, onboarding an existing repo to Claude Code, or when the user asks for CLAUDE.md, PR template, or "our usual conventions".
---

# Repo Conventions

```
python3 scripts/render_conventions.py STACK NAME --dest REPO_DIR --description "one line"
```
STACK is `nextjs-vercel`, `react-vite-supabase`, `python-cli` or `other` (then fill the `(fill in: ...)` lines by reading the repo's package.json / pyproject). Existing files are skipped unless `--force`; never use `--force` on a repo with a hand-written CLAUDE.md without showing the user a diff.

For an **existing** repo, read it first and correct the Commands/Structure sections to what is actually true; don't leave generic text.

The rules baked in come from the user's own repos: Prettier width 100 / double quotes / trailing commas; no committed `.env`; no API keys pasted into client-side HTML or `VITE_*`/`NEXT_PUBLIC_*`; AI calls via a server route or edge function. If a repo already violates them (tracked `.env`, key in HTML), report it and let `repo-ship`'s preflight flag it; don't silently rewrite history.
