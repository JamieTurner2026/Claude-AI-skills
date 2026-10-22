---
name: repo-scaffold
description: Scaffold a new repository from a tested template - Next.js on Vercel, React + Vite + Supabase, or a Python CLI - with lint, formatting, CI workflow, .gitignore that excludes secrets, .env.example and README already set up. Use when the user wants to start, create, bootstrap, or initialise a new project/repo/app and needs the base files.
---

# Repo Scaffold

Templates in `assets/` (all verified to install, lint and build/test cleanly):

| stack | use for | stack details |
|---|---|---|
| `nextjs-vercel` | web apps/APIs deployed on Vercel | Next 15 App Router, TS, Tailwind 4, ESLint 9 + Prettier |
| `react-vite-supabase` | SPA with Supabase backend (same shape as the user's Lovable-style apps) | Vite 7, React 19, TS, Tailwind 4, TanStack Query, supabase-js, `supabase/functions/` |
| `python-cli` | scripts/tools/automation | src layout, pyproject (hatchling), pytest, ruff |

Pick from the user's description; if genuinely unclear ask one question. A plain static single-page tool can use `react-vite-supabase` without Supabase configured. If the user wants a TanStack Start / Cloudflare app, say it isn't templated here (build it in Lovable) and apply `repo-conventions` instead.

## Run
```
python3 scripts/scaffold.py STACK NAME --dest ./NAME --description "one line" [--install] [--git]
```
- `NAME` is normalised to kebab-case (`{{name}}`) and snake_case (`{{pkg}}`).
- Refuses a non-empty destination. Never pass `--dest` pointing at an existing repo.
- `--install` runs `npm install` (creates the lockfile CI's `npm ci` needs). Always use it for Node stacks.
- `--git` runs `git init -b main` and stages files; it does not commit or push (that is `repo-ship`, which asks first).

After scaffolding, run the stack's checks (`npm run lint && npm run typecheck && npm run build`, or `pip install -e .[dev] && ruff check . && pytest`) and fix anything that fails before reporting done. Then hand off to `repo-conventions` (CLAUDE.md, PR template) and `repo-features` if features were requested.

## Adding or changing a template
Put files under `assets/<stack>/`; name `.gitignore` as `_gitignore`; use the three placeholders. Prettier style for all JS/TS: width 100, double quotes, semicolons, trailing commas.
