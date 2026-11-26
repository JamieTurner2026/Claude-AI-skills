# MCP for Blender: repo snapshot (source)

Source: `mcp-for-blender-main.zip` uploaded by Jay on 2026-11-24 (upstream `ahujasid/mcp-for-blender`, formerly `blender-mcp`; PyPI `mcp-for-blender`), version 2.3.1, MIT licence, author Siddharth Ahuja. Not made by the Blender Foundation.
Read: `README.md`, the Claude plugin manifest (`integrations/claude/mcp-for-blender/`), the tool list in `src/blender_mcp/server.py`, and `src/blender_mcp/guides/*.md`. Nothing was run.
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- Two parts: a Blender add-on (`addon.py`) that opens a socket server inside a running Blender, and an MCP server (`server.py`) that talks to it. The add-on starts when Blender opens; it needs Blender 3.0+, Python 3.10+ and `uv`.
- Setup per the README: `uvx mcp-for-blender setup` (finds Claude Desktop, Claude Code and other clients, installs and enables the add-on). Claude Code manually: `claude mcp add blender uvx mcp-for-blender`, then `uvx mcp-for-blender install-addon`. README: run only one MCP server instance at a time.
- Nine tools: `execute_blender_code` (run Python in live Blender), `look` (viewport, camera, multi-angle sheet or animation frame strip, in solid/material/rendered/wireframe/x-ray), `get_scene_info`, `search_assets` / `import_asset` (Poly Haven, Sketchfab, Poly Pizza), `generate_3d` (Tripo, Hunyuan3D, Hyper3D Rodin, Meshy), `generate_gaussian_world` (World Labs, Blender 5.3+), `get_addon_status`, `disable_telemetry`, `record_trajectory_feedback`.
- Asset libraries: Poly Haven is CC0 with no key; Poly Pizza needs a free key and about 69% of its models are CC-BY (credit required); Sketchfab licences vary per model. AI generators need the user's own paid keys or the author's paid Premium.
- Telemetry: an anonymous usage record (install ID, tool name, success, timing, versions, OS) is sent by default. Prompts, code, screenshots and scene data only with opt-in. `DISABLE_TELEMETRY=true` turns all of it off.
- README warning: `execute_blender_code` runs arbitrary Python; save work before using it.
- Seven guides the server serves on request through `get_guide`: `bpy`, `scene`, `materials`, `animation`, `rigging`, `retopology`, `level-design`. Copied unchanged into `guides/` with the MIT licence.
