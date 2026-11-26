---
title: MCP for Blender setup on the PC
dept: gamedev
type: howto
sources:
  - raw/gamedev/blender-skills/mcp-for-blender/2026-11-24_repo-snapshot.md
updated: 2026-11-24
last_used: 2026-11-24
---
# MCP for Blender setup on the PC

**Not done. Jay decides whether to install it.** It only works on the PC with Blender open; the cloud sessions and the headless `blender-visuals` skill don't need it. Source: [[raw/gamedev/blender-skills/mcp-for-blender/2026-11-24_repo-snapshot]]

## What it would add
Claude controls the Blender window you have open: runs Python in it, takes screenshots from any angle to check its work, and pulls free Poly Haven HDRIs, textures and models.

## Steps (from the repo's README)
1. Install `uv`: `winget install --id=astral-sh.uv -e`, then open a new terminal.
2. Run `uvx mcp-for-blender setup` and pick Claude Code (and Claude Desktop if wanted). It keeps your config and saves a `.bak` of each file it changes.
3. Turn off telemetry: add `"env": { "DISABLE_TELEMETRY": "true" }` to the `blender` entry it added.
4. Quit and reopen the Claude app, open Blender, press N in the 3D view, open the **MCP for Blender** tab and check the server is running.
5. In the sidebar, tick **Poly Haven** only (CC0, no key). Leave the paid generators off.

## Rules
- Save the .blend before asking for changes: `execute_blender_code` runs any Python in Blender.
- One MCP server at a time (Claude Desktop or Claude Code, not both).
- Credit Poly Pizza CC-BY models if used; Poly Haven needs no credit.
- Don't open .blend files or scripts from people you don't trust.

## Related
- [[wiki/gamedev/blender-skills]] · [[depts/gamedev]]
