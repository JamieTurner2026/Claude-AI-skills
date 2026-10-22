#!/usr/bin/env python3
"""Pre-push safety scan.  preflight.py [REPO_DIR]   exit 1 if problems found.
Checks: tracked .env files, secret-looking strings, hard-coded API key constants in client files, missing .gitignore/.env.example."""
import os, re, subprocess, sys

repo = sys.argv[1] if len(sys.argv) > 1 else "."
def git(*a): return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True).stdout
files = [f for f in git("ls-files").splitlines() if f] or [os.path.relpath(os.path.join(r, f), repo) for r, d, fs in os.walk(repo) if ".git" not in r and "node_modules" not in r for f in fs]
problems, warns = [], []
for f in files:
    base = os.path.basename(f)
    if re.match(r"\.env(\..+)?$", base) and base != ".env.example": problems.append(f"tracked env file: {f} (git rm --cached {f}; add to .gitignore; rotate any real secret)")
PATS = [(r"sk-ant-[A-Za-z0-9_-]{20,}", "Anthropic API key"), (r"sk-[A-Za-z0-9]{32,}", "OpenAI-style key"), (r"ghp_[A-Za-z0-9]{30,}", "GitHub token"),
        (r"AKIA[0-9A-Z]{16}", "AWS access key"), (r"AIza[0-9A-Za-z_-]{35}", "Google API key"), (r"-----BEGIN (RSA |EC )?PRIVATE KEY-----", "private key"), (r"service_role['\"]?\s*[:=]\s*['\"]eyJ", "Supabase service-role key")]
CLIENT = re.compile(r"\.(html|jsx|tsx|vue)$|(^|/)(src|public|frontend|app)/")
for f in files:
    path = os.path.join(repo, f)
    try:
        if os.path.getsize(path) > 2_000_000: continue
        t = open(path, encoding="utf-8", errors="ignore").read()
    except OSError: continue
    for pat, label in PATS:
        if re.search(pat, t): problems.append(f"{label} pattern in {f}")
    if CLIENT.search(f) and re.search(r"(const|let|var)\s+\w*API_?KEY\s*=\s*['\"]", t, re.I): warns.append(f"hard-coded API key variable in client file {f}: users must paste keys into source; move calls behind a server route")
    if re.search(r"NEXT_PUBLIC_\w*(SECRET|SERVICE_ROLE|PRIVATE)", t) or re.search(r"VITE_\w*(SECRET|SERVICE_ROLE|PRIVATE)", t): problems.append(f"secret exposed through public env prefix in {f}")
if not os.path.exists(os.path.join(repo, ".gitignore")): problems.append("no .gitignore")
elif ".env" not in open(os.path.join(repo, ".gitignore")).read(): problems.append(".gitignore does not exclude .env")
if not os.path.exists(os.path.join(repo, ".env.example")): warns.append("no .env.example documenting required variables")
for p in problems: print("PROBLEM:", p)
for w in warns: print("WARN:   ", w)
print(f"{len(problems)} problem(s), {len(warns)} warning(s)")
sys.exit(1 if problems else 0)
