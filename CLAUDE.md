# Repo template with Claude skills

This template carries the user's skills in `.claude/skills/`: repo-builder (start a project), repo-scaffold, repo-conventions, repo-features, repo-ship, video-knowledge, blender-visuals, claude-skills-api, cad-parts (exact parts with build123d), 19 `blender-*` production skills (start with blender-core; 9 more are filed in `JDOLLA/SuperOS/raw/gamedev/blender-skills/`), and 18 game-dev skills (6 `unreal-*` plus engine-neutral ones; more are filed in `JDOLLA/SuperOS/raw/gamedev/unreal-skills/`).

To start a project from it: ask Claude "use repo-builder to start a new <stack> project called X". Then replace this file with the generated CLAUDE.md.
Secrets: never commit `.env*` except `.env.example`.
