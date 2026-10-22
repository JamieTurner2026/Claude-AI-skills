#!/usr/bin/env python3
"""Copy a stack template into a new directory and fill placeholders.

  scaffold.py STACK NAME --dest DIR [--description TEXT] [--install] [--git]

STACK: nextjs-vercel | react-vite-supabase | python-cli
Placeholders: {{name}} (kebab-case), {{pkg}} (snake_case), {{description}}.
Refuses to write into a non-empty directory.
"""
import argparse, os, re, shutil, subprocess, sys

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("stack"); p.add_argument("name"); p.add_argument("--dest", required=True)
    p.add_argument("--description", default="A new project."); p.add_argument("--install", action="store_true")
    p.add_argument("--git", action="store_true")
    a = p.parse_args()
    src = os.path.join(ASSETS, a.stack)
    if not os.path.isdir(src):
        sys.exit(f"unknown stack {a.stack!r}; choose from {sorted(os.listdir(ASSETS))}")
    name = re.sub(r"[^a-z0-9]+", "-", a.name.lower()).strip("-")
    if not name: sys.exit("name must contain letters or digits")
    pkg = name.replace("-", "_")
    if pkg[0].isdigit(): pkg = "p_" + pkg
    if os.path.isdir(a.dest) and os.listdir(a.dest): sys.exit(f"{a.dest} is not empty; refusing to overwrite")
    subs = {"{{name}}": name, "{{pkg}}": pkg, "{{description}}": a.description}

    def fill(s):
        for k, v in subs.items(): s = s.replace(k, v)
        return s

    for root, _, files in os.walk(src):
        rel = os.path.relpath(root, src)
        out_dir = os.path.join(a.dest, "" if rel == "." else fill(rel))
        os.makedirs(out_dir, exist_ok=True)
        for f in files:
            out = os.path.join(out_dir, ".gitignore" if f == "_gitignore" else fill(f))
            text = open(os.path.join(root, f), encoding="utf-8").read()
            open(out, "w", encoding="utf-8").write(fill(text))
    print(f"scaffolded {a.stack} as '{name}' in {a.dest}")
    if a.install:
        if a.stack == "python-cli":
            print("python: run `python -m venv .venv && .venv/bin/pip install -e .[dev]` yourself (skipped)")
        else:
            subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=a.dest, check=True)
    if a.git:
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=a.dest, check=True)
        subprocess.run(["git", "add", "-A"], cwd=a.dest, check=True)
        print("git initialised and files staged (not committed)")


if __name__ == "__main__":
    main()
