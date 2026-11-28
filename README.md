# claude-repo-template

Skills for starting projects fast with Claude: **repo-builder**, repo-scaffold, repo-conventions, repo-features, repo-ship, video-knowledge, blender-visuals, claude-skills-api (generate xlsx/pptx/pdf/docx through the Claude API), cad-parts (exact mechanical parts as STEP/STL/GLB with [build123d](https://github.com/gumyr/build123d)), video-remake (rebuild a reference video as a matching three.js render, refine it, or recolour part of the original), plus 19 `blender-*` production skills from [Blender Agent Skills](https://github.com/EL4CTEO/blender-skills) (MIT; start with `blender-core`, needs Blender 5.2+). Nine more are filed in `JDOLLA/SuperOS/raw/gamedev/blender-skills/` to switch on later. Also 18 game-dev skills from [awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) (Apache-2.0): 6 Unreal Engine skills and engine-neutral ones for AI, physics, cameras, input, UI, saves, audio and Steam. The rest are filed in `JDOLLA/SuperOS/raw/gamedev/unreal-skills/`.

## Use it
- **Per repo:** click "Use this template". The skills in `.claude/skills/` load automatically in Claude Code.
- **Everywhere:** `git clone <this repo> && ./install.sh` copies them to `~/.claude/skills`, so you can call them from any folder. `./install.sh --check` lists what is installed.
- **Windows:** in the repo root, `powershell -ExecutionPolicy Bypass -File .\install.ps1` does the same into `%USERPROFILE%\.claude\skills` (`-Check` lists them). Re-run it after every update so new skills appear as `/` commands.
- **Claude.ai:** upload the packaged `.skill` files in Settings > Skills (skills do not sync from GitHub automatically).

**Your own virtual machine:** `vm/` creates an Ubuntu server VM on Windows with Multipass (Docker, Node.js and Python are preinstalled). See [vm/README.md](vm/README.md).

Then just ask: "use repo-builder to start a new Next.js project called X".
Never commit `.env*` except `.env.example`.
