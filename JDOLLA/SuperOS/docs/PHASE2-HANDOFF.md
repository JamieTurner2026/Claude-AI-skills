# Phase 2 hand-off: bridge and dashboard

Written 2026-11-15 by the cloud session that drafted Phase 1, for the Claude Code session that builds Phase 2 on Jay's PC. Read this and `CLAUDE.md` before writing anything.

## Where things stand
- **Phase 1 (vault) is drafted.** Layout, router `CLAUDE.md`, seven department routers in `depts/`, charter and project notes in `wiki/`, sources in `raw/`. See [[docs/STATUS]].
- **Not done from Phase 1:** importing Jay's existing Claude Code sessions and project docs. That belongs to Phase 3 (`brain import sessions`); do not block Phase 2 on it.
- **This vault was drafted in a public GitHub repo** (`JamieTurner2026/Claude-AI-skills`, folder `JDOLLA/`). On the PC it gets its own `git init`. Keep client or employer detail out of anything that is pushed publicly.

## Owner settings
- Owner: Jay. Brand: JDOLLA$. Timezone: America/New_York.
- Machine: Windows PC. Obsidian is installed; nothing may depend on it running.
- Departments (slugs): `software`, `security`, `ai`, `gamedev`, `industrial`, `strategy`, `creative`.
- Jay prefers plain, simple explanations and short steps.

## How to work
- Build one step at a time. Show Jay the result of each step and wait for his OK.
- TypeScript in strict mode, Node's native TypeScript (no build step), zod for every external input, almost no dependencies. Tell Jay every dependency you add and why.
- Everything stays on this machine unless Jay opts in.
- When a step is finished: update [[docs/STATUS]], add lessons to [[docs/LEARNINGS]], commit with a conventional commit message, tell Jay the one next step.

## Windows adaptations (the blueprint assumed a Mac)
- No `~/Library`. Put logs under `%LOCALAPPDATA%\JDOLLA\logs` and, later, the brain index under `%USERPROFILE%\.superos\brain\`.
- `npm run open` must open the default browser the Windows way (`start`), with the signed session.
- Hook scripts (Phase 3) should be Node or PowerShell, not `.sh`.
- Paths: use `node:path` everywhere; never build paths by string concatenation. Realpath every destination before a write.
- **Sandbox:** the blueprint relies on Claude Code's own sandbox for any run with Bash. Check whether it is available on this Windows machine. If it is not, runs with Bash must refuse; do not fall back to unsandboxed commands. Tell Jay what you found.
- Kill processes by exact PID. Never a broad kill by name.

## Build order
Each step ends with `npm run check` and `npm test` clean.

a. **Skeleton and contract.** `os/package.json` (scripts: `start`, `open`, `check` = `tsc --noEmit`, `test` = `node --test`), `os/tsconfig.json`, `os/.env.example` (`SUPEROS_PORT=4317`, blank router key, `SUPEROS_SCHEDULER=on`, `SUPEROS_VOICE=off`), `os/shared/types.ts` (`OsState`, route result, run request), `os/config/os.config.json` (`owner`, `brand`, `timezones`, `engine`, `artifactRoots`, `pinnedSkills`, `layout[]`).

b. **Three-tier classifier.** `os/shared/router.ts`: pure, dependency-free, returns probabilities for T1/T2/T3, runs on every keystroke.
   - T1, instant, no AI: `open/show/find`, `/skill-name`, "show routines", "open <dept>".
   - T2, quick answer: `claude -p --model haiku --effort low`, read-only, no file writes.
   - T3, real work: `claude -p --model opus --effort high --permission-mode acceptEdits`.
   - A keyword that can spend money must match a clear work request. "open the audit report" is T1. A wrong T1 costs a toast; a wrong T3 costs a paid run.
   - Bound every regex that faces typed or untrusted text.

c. **Indexer.** `os/bridge/indexer.ts` fills `OsState` from the vault: departments and their skills from `depts/*.md`, wiki and raw counts, directives from `wiki/directives.md`, `routines/routines.json`, `apps/apps.json`.

d. **Bridge server.** `os/bridge/server.ts`, `127.0.0.1` only, port from `os/.env`. Every `/api` route needs a signed token; sessions expire after 24 hours. First endpoints: `/api/state`, `/api/route`, `/api/layout`, `/api/directives/toggle`, `/api/directives/add`, `/api/file` (guarded), `/api/open`.

e. **Dashboard shell.** `os/app/`, plain TypeScript served type-stripped. Widget grid saved to `os/config/os.config.json`; command bar showing T1/T2/T3 bars before Enter; first widgets: Directives, Departments, Routines, Clock. One file per widget, from `os/app/widgets/_template.ts`. Default look: near-black forest ground, green-tinted cards, one lime accent, pale mint text, Outfit font, colours as CSS tokens. Ask Jay whether he wants a different look before building it; his creative likes are in [[wiki/creative/creative-likes]].

f. **Runs.** `/api/run`, `/api/runs`, `/api/runs/:id/stop`, SSE stream. T3 runs headless from its own folder under `outputs/_work/`; the deliverable is copied to `outputs/YYYY-MM/`. Strip inherited config (global hooks, skills, MCP) from T2 runs. Pass the spend limit to the thing that spends (`--max-budget-usd`). Log every route, decision and cost to `logs/router.jsonl`.

g. **Skill policy and containment.** `os/config/skills.policy.json`: default tools `Read, Glob, Grep, Write, Edit`; more only by name. The bridge rewrites the deny rules from `.claude/settings.json` with absolute paths when it starts a run. Never put file tools in `--allowedTools`.

Later tabs and widgets (Work, Research, Backbone, usage, the orb) come after (a) to (g) pass.

## Acceptance for Phase 2
- `npm run check` and `npm test` clean.
- A T1, a T2 and a T3 request each route and run end to end; a T3 deliverable lands in `outputs/`.
- A run that tries to read `.env` or write `os/` is actually blocked. Prove it by attacking the boundary, with a negative control beside every check. A model refusing is not a block.
- Requests with no token or a bad token are rejected, and the server does not listen on any address but 127.0.0.1.

## Not part of the build (Jay's own to-do list)
- Rotate the Google API key that is inline in the DDA2 training app.
- Repoint the Vercel project `legend-of-doom` to the `LEGEND-OF-DOOM` repo.
