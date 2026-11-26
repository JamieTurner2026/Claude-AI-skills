# Craft guides

Read the one that matches the job before writing the scene script. Adapted from MCP for Blender v2.3.1 guides (MIT, (c) 2025 Siddharth Ahuja). Original: `JDOLLA/SuperOS/raw/gamedev/blender-skills/mcp-for-blender/guides/`. Live-Blender tool calls are replaced with the headless way: render a preview with `scripts/render.py` and Read the PNG; print facts from the scene script.

| Job | Read |
|---|---|
| Any script (version-proof bpy, nodes, operators) | `bpy.md` |
| Composition, scale, camera, light | `scene.md` |
| Real-looking surfaces, textures | `materials.md` |
| Keyframes, loops, motion checks | `animation.md` |
| Moving parts, robots, characters | `rigging.md` |
| Clean or lighten a mesh, UVs, bake | `retopology.md` |
| Game levels, Unreal/Godot/Unity export | `level-design.md` |

## Headless checks (instead of the MCP `look` / `get_scene_info` tools)
- See it: `render.py SCENE.py --out OUT --width 640 --height 360 --samples 8`, then Read the PNG. For other angles, pass an arg (e.g. `--arg view=top`) and set `direction=` in `add_camera_fit`: top `(0,0,1)` (nudge y slightly, e.g. `(0,-0.01,1)`), front `(0,-1,0)`, side `(1,0,0)`.
- Wireframe/x-ray look: add a Wireframe modifier to a copy, or render with a thin emissive material.
- Motion: `--frames N --mp4`, then Read 2-3 PNGs from `OUT/frames/` (start, middle, loop seam).
- Facts: `print()` from `build()` (object names, `bounds(objs)`, triangle counts via `sum(len(p.vertices)-2 for p in obj.data.polygons)`); render.py's output shows them.
