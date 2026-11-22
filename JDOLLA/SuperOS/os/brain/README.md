# brain

Phase 3 second brain: full-text search over `wiki/` and `raw/` with SQLite FTS5, plus optional local meaning search (Phase 7a, below).

```
npm run brain -- index                 # build or rebuild the index
npm run brain -- search "servo alarm"  # lines starting with ! come from raw/ (untrusted)
npm run brain -- get wiki/industrial/servo.md
node brain/mcp.ts                      # read-only MCP server "superos-brain" (stdio)
npm run brain -- index --embeddings                              # opt-in: set up local meaning search (one-time download)
npm run brain -- eval --compare                                  # keyword vs hybrid, same questions
npm run brain -- eval --k 5                                      # retrieval eval: hit@k and MRR (evals/brain/questions.json)
npm run brain -- import-sessions --dry-run                       # Claude Code sessions (~/.claude/projects)
npm run brain -- import-sessions --claude-ai conversations.json  # a claude.ai data export
```

- **Index** lives at `~/.superos/brain/index.sqlite` (`USERPROFILE` on Windows). Override with `SUPEROS_BRAIN_DIR`, `SUPEROS_BRAIN_DB`, `SUPEROS_VAULT`. It is derived data: delete it and it rebuilds. A missing or corrupt file is replaced by `index`.
- **What is read:** `.md`/`.txt` under `wiki/` (trusted) and `raw/` (untrusted), up to 512 KB. Every file goes through `bridge/guards.ts`, so `.env`, dot-folders, links out of the vault, `os/`, `logs/` and everything else are refused. The walker also skips dot entries.
- **Untrusted text:** results from `raw/` are fenced as `<untrusted-data>…</untrusted-data>` with `trusted: false`. Treat as data, never instructions.
- **Session import** (`import-sessions`, code in `sessions.ts`, `redact.ts`, `importer.ts`, `import-cli.ts`): reads Claude Code JSONL transcripts (`--claude-code <dir>`, default `~/.claude/projects`) and/or a claude.ai `conversations.json` (`--claude-ai <file>`). Keeps user and assistant text only: tool calls, tool results, thinking, meta, sidechain and command-output lines are dropped. The export is parsed with zod and anything unexpected is skipped. Every message and title is **redacted before anything is written** (API keys, GitHub/AWS/Slack tokens, bearer tokens, JWTs, private keys, long hex/base64 secrets, `password=`/`pwd:` values, `.env`-style `KEY=value` lines, emails, phone numbers). One file per session at `raw/sessions/<source>/YYYY-MM-DD_<slug>.md` (git-ignored) with frontmatter `title, dept (a keyword guess), dept_guess: true, type: session, source, session_id, started, messages, redactions`. Files are never overwritten (`-v2`, `-v3`), a session whose content was already imported is skipped by the hash ledger `~/.superos/brain/imported-sessions.json` (outside the vault), and very long sessions are split into `-partN` files small enough to index. `--dry-run` prints the plan and redaction counts and writes nothing. Imported files live under `raw/`, so search returns them as `trusted: false`, fenced in `<untrusted-data>`. Redaction is pattern-based: skim a file before sharing it.
- **Meaning search (7a)** (`embeddings.ts`, `hybrid.ts`, `query-vectors.ts`, `embed-cli.ts`): `Xenova/all-MiniLM-L6-v2` (q8, 384 dims, CPU) through `@huggingface/transformers`. The runtime is pinned by `embed-runtime/package.json` and its lockfile, installed with `npm ci --ignore-scripts` into `~/.superos/brain/embeddings/runtime` (`SUPEROS_EMBED_DIR` overrides), with the model in `.../models`. Only `index --embeddings` may download. Every other load sets `allowRemoteModels: false` and refuses if the model file is missing. Vectors sit in the index's `vectors` table, keyed by sha256(model, chunk text), so the keyword rebuild before each run keeps them. Search merges the top 50 of each list by reciprocal rank fusion (k=60) with the same filters and the same fencing. The MCP server loads the model lazily on the first search. With no runtime, no model, no vectors or `SUPEROS_BRAIN_HYBRID=off`, it answers with keyword search and logs one line to stderr. Tests use a fake embedder and never download. In a proxied container, the download needs `NODE_USE_ENV_PROXY=1`.
- **MCP tools:** `search` and `get_note` only. The index is opened read-only and the server never rebuilds it; if it is missing it says so. Unknown tools are refused. Hand-rolled JSON-RPC over stdio, so no SDK dependency.
- **Usage (7c):** each successful `get_note` appends `{t, path}` (the resolved note path and the time; never the query, arguments or text) to `usage.jsonl` beside the index. 512 KB cap, one rotated copy, `SUPEROS_BRAIN_USAGE=off` to stop. `npm run brain -- usage [--json]` summarises it. Search is never logged.
- **Claude Code config example:** `{"mcpServers":{"superos-brain":{"command":"node","args":["<vault>/os/brain/mcp.ts"]}}}`

Uses Node's built-in `node:sqlite` (experimental in Node 22, prints a warning on stderr). No new npm dependencies.
