# Repo template with Claude skills

This template carries the user's skills in `.claude/skills/`: repo-builder (start a project), repo-scaffold, repo-conventions, repo-features, repo-ship, video-knowledge, blender-visuals, claude-skills-api.

To start a project from it: ask Claude "use repo-builder to start a new <stack> project called X". Then replace this file with the generated CLAUDE.md.
Secrets: never commit `.env*` except `.env.example`.

## Projects
- `projects/midnight-regin/` — MIDNIGHT REIGN, UE5 street racer (merged from JamieTurner2026/Midnight-regin, branch `claude/clever-dirac-i4x75k`, Milestone 2 code complete, needs playing in the editor). It has its own `CLAUDE.md` with commands and rules; work inside that folder. Its `blender/` pipeline can use the `blender-visuals` skill. CI: `.github/workflows/midnight-regin.yml`.
