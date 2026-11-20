# Status

Updated 2026-11-20.

## What exists
- Phase 1 vault: folder layout, router `CLAUDE.md`, seven department routers, `Home.md`, containment settings, `.gitignore`.
- Seed content: one source brief per department in `raw/<dept>/charter/`, and one charter note per department in `wiki/<dept>/`.
- Project notes (2026-11-14): six project notes written from shallow clones of Jay's repos, each with a snapshot in `raw/`: MIDNIGHT REIGN, Davidson Blessons, API Bible, Car Finder app, DDA2 Training Hub, Assembly Trainer Pro. Plus a LEGEND OF DOOM stub.
- Concept notes: `wiki/ai/memory-types.md`, `wiki/creative/creative-likes.md` (a running list of Jay's likes).
- Skill draft: `skills/weekly-review/SKILL.md` (inert, not installed).
- Phase 2 steps (a) to (e), built and tested in the cloud (2026-11-15) in `os/`: skeleton and contract, three-tier router, vault indexer, local bridge server (127.0.0.1 only, signed 24-hour sessions, guarded file access) and the dashboard (command bar with T1/T2/T3 bars, Directives, Clock, Departments and Routines widgets, midnight-and-neon look). 22 tests pass, and the dashboard was loaded in a real browser at desktop and phone width with no console errors.

## What does not exist yet
- Step (f) runs: built 2026-11-19. T2 and T3 requests run Claude Code headless from the dashboard (Runs widget: live output, cost against cap, Stop). T3 asks for confirmation first and has no Bash until step (g). One real T2 run worked here: right answer from the vault, $0.0012 of a $0.05 cap. 69 tests pass.
- Step (g) containment: built 2026-11-19. Skill policy (`os/config/skills.policy.json`), the vault's own deny rules restated with absolute paths for every run, Bash only inside Claude Code's sandbox (with no unsandboxed fallback), blocked tool calls shown on the dashboard and logged. 76 tests pass.
- Proven with real capped runs on a throwaway vault copy holding fake `.env` secrets: a direct Read of `os/.env` was **blocked by the CLI** (not just refused by the model) and nothing leaked; an allowed note read fine. A Grep attack also leaked nothing, but only because ripgrep skips hidden files, so the Grep deny path is **not yet proven**.
- On Jay's Windows PC there is **no Claude Code sandbox** (Claude Code's docs: native Windows runs commands unsandboxed), so runs that need Bash are refused there unless Claude Code runs inside WSL2. Windows deny-rule paths with drive letters (`//C:/...`) are untested.
- Routines (Phase 4 wiring): built 2026-11-19. Switch a routine on in the dashboard's Routines widget and it runs at its time while the bridge runs with `SUPEROS_SCHEDULER=on`. Run now works any time. All routines combined are capped at $1 per day (a routine only starts if its full budget still fits); each slot runs at most once, even across restarts. Read-only routines reply and the bridge writes their report to `reports/`. One real run of plan-today: a sourced plan from the vault for $0.0027. All four routines ship switched off.
- Second brain in runs: built 2026-11-20. Every T2/T3 run and routine gets the read-only `superos-brain` tools (`search`, `get_note`) and nothing else extra; the index is rebuilt first if it is over 5 minutes old, and a failed rebuild never blocks a run. Off switch: `engine.brain.enabled`. One real run on a vault copy searched the brain twice, opened the right note and answered from it for $0.0008. 138 tests pass.
- No learning loop yet (Phase 5). Local embeddings and session import for the brain are still open.
- Not checked on Windows: `npm run open` (uses `rundll32`), the `%LOCALAPPDATA%\JDOLLA\logs` path, opening files with `explorer.exe`, and whether Claude Code's sandbox exists there. Tested on Linux only.
- No imported Claude Code sessions or project docs. That import needs the PC.
- `daily/`, `projects/`, `reports/` and `logs/` are created by the bridge and are git-ignored.

## Needs Jay
- Set the OS up on the PC with `docs/PC-SETUP.md`, including its Windows checks (section 11), and report what each one shows. If the PC copy already has its own work in `os/`, merge instead of overwriting (section 2).
- This vault was drafted in a cloud session inside the `Claude-AI-skills` repo. Copy `JDOLLA/` to its permanent folder on the PC, then `git init` there.
- Review the department charters; they were distilled from the interview answer.
- Review the project notes. Each lists what is unknown; the two private repos are described by structure and purpose only.
- LEGEND OF DOOM now has its own repo, but its Vercel project still builds from a `car-finder-app` branch. Repointing it is Jay's call.

## Known gaps
- The blueprint assumes a Mac. On Windows the sync hook, log path and sandbox need adapting in Phases 2 and 3.
- Seven departments, against the blueprint's suggested 3 to 6.
- The Business Strategy department has only a draft skill.
- Project notes were written from README, package files and file listings, not from a full code read. Security and Strategy have no project notes.
