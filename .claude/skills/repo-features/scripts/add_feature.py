#!/usr/bin/env python3
"""Copy a feature module into a repo.  add_feature.py MODULE --dest REPO_DIR [--list]
Modules: video-knowledge, blender-visuals (-> tools/<name>/), ai-chat (-> app/api/chat/route.ts, Next.js only)."""
import argparse, os, shutil, sys
M = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "modules")
p = argparse.ArgumentParser(); p.add_argument("module", nargs="?"); p.add_argument("--dest"); p.add_argument("--list", action="store_true"); a = p.parse_args()
if a.list or not a.module: print("\n".join(sorted(os.listdir(M)))); sys.exit(0)
if not a.dest: sys.exit("--dest required")
src = os.path.join(M, a.module)
if not os.path.isdir(src): sys.exit(f"unknown module; have {sorted(os.listdir(M))}")
if a.module == "ai-chat":
    if not os.path.isdir(os.path.join(a.dest, "app")): sys.exit("ai-chat module needs a Next.js app/ directory")
    dst = os.path.join(a.dest, "app", "api", "chat"); os.makedirs(dst, exist_ok=True)
    if os.path.exists(os.path.join(dst, "route.ts")): sys.exit("app/api/chat/route.ts exists; not overwriting")
    shutil.copy(os.path.join(src, "nextjs", "route.ts"), dst)
    print("added app/api/chat/route.ts; set ANTHROPIC_API_KEY (server-side only)")
else:
    dst = os.path.join(a.dest, "tools", a.module)
    if os.path.exists(dst): sys.exit(f"{dst} exists; not overwriting")
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__")); print(f"added tools/{a.module}/ (see its MODULE.md and REFERENCE.md)")
print(open(os.path.join(src, "MODULE.md")).read())
