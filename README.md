# claude-repo-template

Skills for starting projects fast with Claude: **repo-builder**, repo-scaffold, repo-conventions, repo-features, repo-ship, video-knowledge, blender-visuals.

## Use it
- **Per repo:** click "Use this template". The skills in `.claude/skills/` load automatically in Claude Code.
- **Everywhere:** `git clone <this repo> && ./install.sh` copies them to `~/.claude/skills`, so you can call them from any folder. `./install.sh --check` lists what is installed.
- **Claude.ai:** upload the packaged `.skill` files in Settings > Skills (skills do not sync from GitHub automatically).

Then just ask: "use repo-builder to start a new Next.js project called X".
Never commit `.env*` except `.env.example`.
