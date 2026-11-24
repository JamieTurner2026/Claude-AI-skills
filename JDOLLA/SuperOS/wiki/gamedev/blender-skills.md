---
title: Blender skills from outside repos
dept: gamedev
type: concept
sources:
  - raw/gamedev/blender-skills/mcp-for-blender/2026-11-24_repo-snapshot.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/bpy.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/scene.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/materials.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/animation.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/rigging.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/retopology.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/level-design.md
updated: 2026-11-24
last_used: 2026-11-24
---
# Blender skills from outside repos

What each Blender skill repo Jay sends adds to the build, and whether it works now. "Works now" means it works with the headless `blender-visuals` skill (Python scene script, `render.py`, read the PNG), with no Blender window open. Source folder: `raw/gamedev/blender-skills/`.

## MCP for Blender (v2.3.1, MIT)
Source: [[raw/gamedev/blender-skills/mcp-for-blender/2026-11-24_repo-snapshot]]

| Piece | Works now? | What it gives the build |
|---|---|---|
| `bpy` guide | Yes | Scripts that survive Blender versions: find nodes by type, renamed Principled BSDF inputs (`Emission Color` in 4.0+), EEVEE named `BLENDER_EEVEE_NEXT` in 4.2 to 4.x, fcurves moved in 4.4/5.0. It showed two bugs in our helpers, now fixed. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/bpy]] |
| `materials` guide | Yes | Real-looking values for painted metal, plastic, rubber and glass on machine and station renders. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/materials]] |
| `scene` guide | Yes | Block out at real size first, focal lengths (35 to 50 mm natural, 85 mm+ product), three-point light. For training visuals and title cards. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/scene]] |
| `animation` guide | Yes | Keyframes that work in every version; linear motion for conveyors and servos; loop seams. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/animation]] |
| `retopology` guide | Yes | Clean and lighten meshes; triangle budgets (prop 500 to 5k, hero character 15 to 50k). For MIDNIGHT REIGN assets. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/retopology]] |
| `level-design` guide | Yes | Player metrics, grey-box blockout, modular kits, Unreal names (`SM_`, `UCX_` collision), FBX export. Fits MIDNIGHT REIGN (Unreal 5). Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/level-design]] |
| `rigging` guide | Partly | Mechanical rigs (parts parented to bones) fit robot and servo stations now; Rigify characters later. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/rigging]] |
| MCP server and add-on | PC only, not set up | Claude drives a live Blender window: screenshots from any angle, scene info, asset libraries. Needs Blender open on Jay's PC. Steps: [[wiki/gamedev/blender-mcp-setup]] |
| AI model generators, World Labs worlds | No | Paid keys or paid Premium. Left out until Jay asks. |

Where it went: the seven guides are adapted for headless use in the `blender-visuals` skill (`references/`), with the MCP tool calls swapped for preview renders. The originals stay unchanged in `raw/`.

## Related
- Department: [[depts/gamedev]] · Charter: [[wiki/gamedev/charter]] · Project: [[wiki/gamedev/midnight-reign]]
- Also used by [[depts/industrial]] (machine diagrams) and [[depts/creative]] (renders)
