---
name: repo-builder
description: Start a new repository end-to-end - pick a stack, scaffold it, apply conventions, add feature modules, run preflight and ship to GitHub/Vercel. Use when the user says "start a new repo/project/app" or "set up a new project" and wants the whole flow, rather than one step. Orchestrates repo-scaffold, repo-conventions, repo-features and repo-ship.
---

# Repo Builder (orchestrator)

**Step 0:** the sibling skills must be available. If `repo-scaffold` etc. are not listed, tell the user to run `./install.sh` from the claude-repo-template repo (or use the template). Don't recreate their logic by hand.

Ask at most three questions, skipping any already answered: **name + one-line purpose**, **stack** (`nextjs-vercel` web app/API on Vercel, `react-vite-supabase` SPA + Supabase, `python-cli` scripts; Lovable/TanStack apps are built in Lovable), **features** (`video-knowledge`, `blender-visuals`, `ai-chat`, none).

Then, in order, using the sibling skills:
1. `repo-scaffold`: `scaffold.py STACK NAME --dest ./NAME --description "..." --install --git`; run its checks.
2. `repo-conventions`: `render_conventions.py STACK NAME --dest ./NAME`.
3. `repo-features`: `add_feature.py MODULE --dest ./NAME` for each requested feature; re-run checks.
4. Commit locally (conventions in CLAUDE.md).
5. `repo-ship`: preflight, then **ask before** creating the GitHub repo, pushing, setting env vars or deploying.

Report what was created, which checks passed (with real results), and what was skipped or couldn't run. Do not say it shipped unless a push/deploy actually succeeded.
