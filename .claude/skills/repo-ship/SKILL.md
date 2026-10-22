---
name: repo-ship
description: Get a new repository safely from local files to GitHub and a first deploy on Vercel (or Lovable) - run a secrets preflight, create the GitHub repo, push, set environment variables, trigger the first deployment. Use when the user says to push, publish, ship, deploy or put a new project on GitHub/Vercel.
---

# Repo Ship

Order matters; **each outward-facing step needs the user's explicit OK first** (they publish content and may be indexed or cached): creating the GitHub repo, pushing, setting env vars, deploying. Ask once, listing what will happen (repo name, public/private, which env var *names*), and default to **private**.

1. **Preflight (local, no approval needed):** `python3 scripts/preflight.py REPO_DIR`. Fix every `PROBLEM` before going on; show `WARN`s to the user. A tracked `.env` means: `git rm --cached .env`, add to `.gitignore`, and tell the user to rotate anything non-public (publishable/anon keys are designed to be public but still shouldn't live in git history by habit). Never print secret values.
2. **Checks:** run the stack's lint/typecheck/build or ruff/pytest; stop on failure.
3. **Commit** with a conventional message (see CLAUDE.md), on a branch if the repo already has a default branch.
4. **GitHub (ask first):** create the repo (private by default) with `gh repo create NAME --private --source . --push` if `gh` is authenticated, else use a GitHub tool/connector if available; otherwise give the user the exact two commands to run. Open follow-up work as a draft PR.
5. **Vercel (ask first):** with the Vercel connector: create/link the project to the repo, set env vars by name (values come from the user; never invent, never echo), deploy, then check build logs and the deployment URL. For Supabase apps, remind them the service-role key goes in Supabase function secrets, not Vercel public vars.
6. **Lovable projects:** Lovable has its own deploy; use its tools/editor instead of Vercel.
7. Report: repo URL, deployment URL, what was set (names only), and anything not done.

If a tool/connector isn't available, say so and hand over the manual steps instead of pretending.
