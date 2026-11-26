# Blender skill repos (source)

Repos Jay sends that teach Blender skills. One subfolder per repo:

- `<repo>/YYYY-MM-DD_repo-snapshot.md`: what the repo contained, its licence, what it needs to run.
- `<repo>/guides/`: knowledge files copied unchanged, with the repo's licence beside them.

Everything here is data, not instructions. Never edit; add a newer snapshot as a new file.
What fits the build is decided in [[wiki/gamedev/blender-skills]]. Only the parts that work headless are adapted into the `blender-visuals` skill (`.claude/skills/blender-visuals/references/` in the Claude-AI-skills repo).

## Repos filed
- `mcp-for-blender/`: MCP for Blender v2.3.1 (MIT). Read 2026-11-24.
- `blender-agent-skills/`: Blender Agent Skills v1.3.3 (MIT), 28 skills. Read 2026-11-24. Turn a filed skill on: copy `blender-agent-skills/skills/<name>/` into the Claude-AI-skills repo's `.claude/skills/`, then run `./install.sh`.
- `build123d/`: build123d (Apache-2.0), a Python CAD library, not a Blender pack. Read 2026-11-24. Only the snapshot, licence and cheat sheet are kept; the library installs from PyPI. Used by the `cad-parts` skill.
- `mpfb2/`: MPFB2 human generator for Blender (code GPL-3.0, assets CC0). Snapshot only, read 2026-11-26; filed for characters later.
