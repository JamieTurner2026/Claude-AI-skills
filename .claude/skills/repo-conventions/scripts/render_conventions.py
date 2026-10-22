#!/usr/bin/env python3
"""Write CLAUDE.md and a PR template into a repo.  render_conventions.py STACK NAME --dest DIR [--description T] [--force]
STACK: nextjs-vercel | react-vite-supabase | python-cli | other. Existing files are never overwritten without --force."""
import argparse, os, sys

A = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
STACKS = {
    "nextjs-vercel": ("- `npm run dev`: dev server\n- `npm run lint` / `npm run typecheck` / `npm run build`\n- `npm run format`: Prettier",
                      "- `app/`: routes, layouts, `app/api/*/route.ts` server endpoints\n- `tools/`: optional drop-in modules\n- Deployed on Vercel; env vars set in the Vercel dashboard"),
    "react-vite-supabase": ("- `npm run dev`: Vite dev server\n- `npm run lint` / `npm run typecheck` / `npm run build`\n- `npm run format`: Prettier",
                            "- `src/`: React app; `src/integrations/supabase/client.ts` is the only Supabase client\n- `supabase/functions/<name>/`: edge functions (server-side secrets live here)"),
    "python-cli": ("- `pip install -e \".[dev]\"`\n- `ruff check .` and `pytest`", "- `src/<pkg>/`: package, `cli.py` entry point\n- `tests/`: pytest"),
    "other": ("- (fill in: install, dev, lint, test, build commands)", "- (fill in: main directories and what they hold)"),
}
p = argparse.ArgumentParser(); p.add_argument("stack", choices=STACKS); p.add_argument("name"); p.add_argument("--dest", required=True)
p.add_argument("--description", default="A new project."); p.add_argument("--force", action="store_true"); a = p.parse_args()
cmds, struct = STACKS[a.stack]
text = open(f"{A}/CLAUDE.md.tmpl").read().replace("{{name}}", a.name).replace("{{description}}", a.description).replace("{{commands}}", cmds).replace("{{structure}}", struct)
for rel, body in (("CLAUDE.md", text), (".github/pull_request_template.md", open(f"{A}/pull_request_template.md").read())):
    path = os.path.join(a.dest, rel)
    if os.path.exists(path) and not a.force: print(f"skip (exists): {rel}"); continue
    os.makedirs(os.path.dirname(path), exist_ok=True); open(path, "w").write(body); print(f"wrote {rel}")
