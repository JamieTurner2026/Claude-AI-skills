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

## Containment (step g)
- `config/skills.policy.json` lists the tools a T3 run may use (`defaultTools`) and extra tools per skill, by exact name. T2 is always read-only. A missing or broken policy refuses every run.
- The vault's `.claude/settings.json` deny rules are restated with absolute paths for every run; a missing or broken file refuses the run.
- Bash is only offered inside Claude Code's sandbox (macOS; Linux or WSL2 with bubblewrap and socat). Native Windows has no sandbox, so Bash runs are refused there. The run settings also set `failIfUnavailable` and turn off unsandboxed retries.
- Blocked tool calls show on the run in the Runs widget and in `router.jsonl`.

Needs Node 22.18 or newer (it runs TypeScript directly, no build step).

## Routines (Phase 4)
- Switch routines on or off in the dashboard's Routines widget (it rewrites `routines/routines.json`). Run now starts one immediately.
- They run on their own only while the bridge runs with `SUPEROS_SCHEDULER=on` in `os/.env` (set it to `off` to stop all scheduled runs).
- Money: all routines together stop at `engine.routines.dailyCapUsd` ($1/day); each routine's `budgetUsd` is at most `engine.routines.maxBudgetUsd` ($1).
- The ledger `routine-ledger.json` in the log folder records each attempt before it starts and each day's spend.

## Second brain in runs
- Every run gets one MCP server, `superos-brain` (`brain/mcp.ts`, shipped with the bridge), with only its two read-only tools pre-approved: `search` and `get_note`. `--strict-mcp-config` keeps every other server out; file tools are never pre-approved.
- Before each run the index (`%USERPROFILE%\.superos\brain\index.sqlite`, or `~/.superos/brain/`) is rebuilt if it is missing or over 5 minutes old. If that fails the run still goes ahead, without the brain, and `brain-index-failed` is logged.
- Turn it off with `engine.brain.enabled: false` in `config/os.config.json`.

Setting up on the PC: see `../docs/PC-SETUP.md`.
