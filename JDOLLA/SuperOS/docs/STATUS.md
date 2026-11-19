# Status

Updated 2026-11-15.

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
- No scheduler, brain index, routines or learning loop (Phases 3 to 5). `routines.json` and `apps.json` are empty arrays.
- Not checked on Windows: `npm run open` (uses `rundll32`), the `%LOCALAPPDATA%\JDOLLA\logs` path, opening files with `explorer.exe`, and whether Claude Code's sandbox exists there. Tested on Linux only.
- No imported Claude Code sessions or project docs. That import needs the PC.
- `daily/`, `projects/`, `reports/` and `logs/` are created by the bridge and are git-ignored.

## Needs Jay
- Phase 2 steps (a) to (e) are done. Steps (f) and (g) need the PC: start a Claude Code session in the vault folder, have it read `docs/PHASE2-HANDOFF.md` (build order, steps f and g), and first run `npm install`, `npm run check` and `npm test` in `os/` on Windows. If the PC copy already has its own work in `os/`, merge instead of overwriting.
- This vault was drafted in a cloud session inside the `Claude-AI-skills` repo. Copy `JDOLLA/` to its permanent folder on the PC, then `git init` there.
- Review the department charters; they were distilled from the interview answer.
- Review the project notes. Each lists what is unknown; the two private repos are described by structure and purpose only.
- LEGEND OF DOOM now has its own repo, but its Vercel project still builds from a `car-finder-app` branch. Repointing it is Jay's call.

## Known gaps
- The blueprint assumes a Mac. On Windows the sync hook, log path and sandbox need adapting in Phases 2 and 3.
- Seven departments, against the blueprint's suggested 3 to 6.
- The Business Strategy department has only a draft skill.
- Project notes were written from README, package files and file listings, not from a full code read. Security and Strategy have no project notes.
