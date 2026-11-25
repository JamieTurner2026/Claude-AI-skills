# Claude-AI-skills

Two things live in this repo:

- **Skills library**: `.claude/skills/<name>/SKILL.md` is the source of truth. `skill-files/*.skill` are packaged copies for upload to Claude.ai (Settings > Skills); no script rebuilds them, so repackage one by hand when its skill changes. `./install.sh` copies the skills to `~/.claude/skills`; `./install.sh --check` lists what is installed.
- **Second brain (SuperOS)**: `JDOLLA/SuperOS/`. For anything about notes, projects, knowledge, daily planning, routines or the dashboard, read `JDOLLA/SuperOS/CLAUDE.md` first and follow its rules. Don't crawl the vault.

## Checks
- CI: `.github/workflows/superos.yml` runs the SuperOS checks on Linux and Windows for changes under `JDOLLA/SuperOS/**`.
- Locally, in `JDOLLA/SuperOS/os/`: `npm run check` and `npm test`.

## Working rules
- **Think first.** State your assumptions. If a request has more than one reading, ask; don't pick one silently.
- **Keep it simple.** Make the smallest change that solves the task, with no speculative features or abstractions.
- **Make surgical edits.** Touch only what the task needs, match the existing style, and clean up only what you broke.
- **Verify.** Say how you'll know it worked, then check it. A check that can't fail proves nothing.

## Git
- Work on a branch and open pull requests to `main` as drafts.
- Never commit `.env*` except `.env.example`.
