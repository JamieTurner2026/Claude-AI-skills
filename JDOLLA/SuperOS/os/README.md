# os

Dashboard app and bridge server for the JDOLLA$ vault. Phase 2.

```
npm install     # zod, typescript, @types/node
npm start       # bridge on http://127.0.0.1:4317 (port from .env)
npm run open    # opens the dashboard in your browser, signed in
npm run check   # type check
npm test        # tests
```

- `shared/` contract types and the three-tier router (no dependencies).
- `bridge/` server, indexer, guards. Listens on 127.0.0.1 only; every `/api` route needs a signed session.
- `app/` dashboard, plain TypeScript served with types stripped. One file per widget in `app/widgets/`.
- `config/os.config.json` owner settings, run caps (T2 $0.05, T3 $2) and the widget layout.

## Runs (step f)
Press Enter on a question (T2) or a work request (T3). T2 starts at once; T3 asks first because it costs more.
- Runs use the Claude Code CLI (`claude`, or `claude.exe` on Windows; set `engine.claudeBin` in the config if it is elsewhere).
- Every run: `--restricted --strict-mcp-config`, a spend cap, deny rules for `.env`, `os/`, `.claude/`, `logs/`, `.git/`. T2 can only read. T3 can write only in `outputs/_work/<id>/`, and its files are copied to `outputs/YYYY-MM/`.
- Costs and decisions are logged to `router.jsonl` in the log folder.

Needs Node 22.18 or newer (it runs TypeScript directly, no build step).
