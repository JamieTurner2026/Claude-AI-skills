#!/usr/bin/env python3
"""Generate files with Anthropic-managed Skills (xlsx, pptx, pdf, docx) via the API, then download them.

  skills_client.py list
  skills_client.py generate SKILL_ID "prompt..." [--out outputs] [--prefix name_] [--model M] [--max-tokens 4096]

Needs: pip install anthropic>=2 ; env ANTHROPIC_API_KEY (never hard-code it; keep it server-side).
Generation takes about 40 s to 2 min. Model defaults to $ANTHROPIC_MODEL or claude-sonnet-5-5.
"""
import argparse, os, sys

BETAS = ["code-execution-2025-08-25", "files-api-2025-04-14", "skills-2025-10-02"]
TOOLS = [{"type": "code_execution_20250825", "name": "code_execution"}]  # Skills require this tool


def client():
    from anthropic import Anthropic
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("ANTHROPIC_API_KEY is not set (export it, or load it from a .env that is git-ignored)")
    return Anthropic(api_key=key)


def extract_file_ids(response):
    """Collect every file_id anywhere in the response (code-execution result blocks nest them)."""
    data = response.model_dump() if hasattr(response, "model_dump") else response
    found = []

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("file_id"), str) and o["file_id"] not in found:
                found.append(o["file_id"])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(data)
    return found


def download_files(c, file_ids, out_dir="outputs", prefix=""):
    os.makedirs(out_dir, exist_ok=True)
    saved = []
    for fid in file_ids:
        try:
            meta = c.beta.files.retrieve_metadata(fid, betas=["files-api-2025-04-14"])
            name = os.path.basename(meta.filename) or fid
            data = c.beta.files.download(fid, betas=["files-api-2025-04-14"]).read()
            path = os.path.join(out_dir, prefix + name)
            open(path, "wb").write(data)
            saved.append((path, len(data)))
        except Exception as e:  # files expire; download right after creation
            print(f"could not download {fid}: {e}", file=sys.stderr)
    return saved


def generate(c, skill_id, prompt, model=None, max_tokens=4096, version="latest"):
    return c.beta.messages.create(
        model=model or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
        max_tokens=max_tokens,
        container={"skills": [{"type": "anthropic", "skill_id": skill_id, "version": version}]},
        tools=TOOLS,
        messages=[{"role": "user", "content": prompt}],
        betas=BETAS,
    )


def main():
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    g = sub.add_parser("generate"); g.add_argument("skill_id"); g.add_argument("prompt")
    g.add_argument("--out", default="outputs"); g.add_argument("--prefix", default="")
    g.add_argument("--model"); g.add_argument("--max-tokens", type=int, default=4096)
    a = p.parse_args(); c = client()
    if a.cmd == "list":
        for s in c.skills.list(source="anthropic").data:
            print(f"{s.id}\t{s.display_name}\tlatest={s.latest_version_id}")
        return
    r = generate(c, a.skill_id, a.prompt, a.model, a.max_tokens)
    for b in r.content:
        if b.type == "text": print(b.text)
    ids = extract_file_ids(r)
    if not ids: sys.exit("No files in the response: check the tool/skill were included and the task requires a file.")
    for path, size in download_files(c, ids, a.out, a.prefix): print(f"saved {path} ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
