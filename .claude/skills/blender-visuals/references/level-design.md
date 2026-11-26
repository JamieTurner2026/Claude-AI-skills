# Level design

Source: MCP for Blender guide `level-design` (MIT), adapted. Fits MIDNIGHT REIGN (Unreal Engine 5): its `blender/` scripts generate the car, parts and track and export FBX.

## Metrics first
Defaults for a human-scale game; agree them with Jay and adjust to the genre (a racing game cares more about road width and turn radius).

| Thing | Size |
|---|---|
| Player capsule | 1.8 m tall, 0.6 m wide |
| Doorway | 1.2-1.5 m wide, 2.4-3 m tall |
| Corridor | 3-4 m wide |
| Step | 0.2 m rise, 0.3 m run |
| Max climbable ledge | ~1 m |
| Cover (crouch / full) | 1.0 m / 2.0 m |
| Grid unit | 1 m, modules on 2 m or 4 m |

Keep a scale reference in the scene (a 1.8 m capsule named `PlayerScale`, or a car-sized box for a racing track), excluded from export.

## Blockout
- Grey-box the whole level before art: rooms or road, paths, heights, sightlines. One collection per area (`Area_Start`, `Area_Downtown`).
- Snap to the grid: round positions and sizes to the module in the script.
- Critical path first, then branches, loops, secrets. Landmarks (tall, distinct) help navigation.
- Review flow from above: `add_camera_fit(direction=(0, -0.01, 1))` and a preview render; also an eye-height view.

## Modular kits
- Pieces on the grid: wall 4x3 m, floor 4x4 m, corner, doorway, stairs, road straight and curve. Origin at a corner or bottom-centre so pieces snap.
- Repeat with linked duplicates (`obj.copy()` without copying data) or collection instances.
- Scatter props with slight random rotation and scale; keep gameplay-critical props exact.

## Engine-ready output
- Apply transforms (scale 1, rotation 0) on every exported mesh.
- Names: Unreal `SM_<name>` meshes and `UCX_SM_<name>_00` convex collision; Godot `-col` / `-colonly` suffixes; Unity separate low-poly collision meshes.
- Collision is boxes and convex hulls, not the render mesh.
- Print triangle counts per mesh (`retopology.md`) and compare with the platform budget.
- Export: `render.py ... --export level.glb` (glTF, Godot/web) or `bpy.ops.export_scene.fbx(filepath=..., apply_scale_options="FBX_SCALE_UNITS", use_selection=False)` for Unreal/Unity. Read the operator's arguments first; they change between versions.
- Lightmap UVs go in a second UV map when the engine bakes lighting.
