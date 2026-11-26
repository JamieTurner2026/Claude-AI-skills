# Retopology and mesh cleanup

Source: MCP for Blender guide `retopology` (MIT), adapted.

| Goal | Approach |
|---|---|
| Still render, background prop | Leave it; maybe Decimate |
| Game prop (MIDNIGHT REIGN) | Decimate or remesh, then bake normals from the original |
| Deforming character | Quad remesh (QuadriFlow), clean joint loops, then rig |
| 3D print (STL) | Voxel remesh for a watertight solid |

Always work on a copy; keep the original as the bake source: `low = src.copy(); low.data = src.data.copy()`.

## Diagnose (print from the script)
```python
import bmesh
bm = bmesh.new(); bm.from_mesh(obj.data)
print(obj.name, "tris", sum(len(f.verts) - 2 for f in bm.faces),
      "ngons", sum(len(f.verts) > 4 for f in bm.faces),
      "non-manifold", sum(not e.is_manifold for e in bm.edges),
      "boundary", sum(e.is_boundary for e in bm.edges),
      "loose verts", sum(not v.link_edges for v in bm.verts)); bm.free()
```
To see edges: render a copy with a Wireframe modifier (`obj.modifiers.new("W", "WIREFRAME").thickness = 0.002`).

## Clean up
```python
bm = bmesh.new(); bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_edges], context="VERTS")
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(obj.data); bm.free()
```

## Reduce
- **Decimate** keeps shape and UVs, gives triangles: `m = obj.modifiers.new("Decimate", "DECIMATE"); m.ratio = 0.1`. `decimate_type="DISSOLVE"` for hard-surface. Works headless.
- **Voxel remesh**: watertight and even, loses UVs and sharp edges. `obj.modifiers.new("R", "REMESH")` with `mode="VOXEL"`, `voxel_size` ~1/200 of the largest dimension (the modifier works headless; the operator wants an active object).
- **QuadriFlow** for quads: `bpy.ops.object.quadriflow_remesh(target_faces=4000)`; slow, can fail on non-manifold input, so voxel remesh first.
- **Shrinkwrap** the low mesh onto the high one (`target = high`) to recover the silhouette.

Face budgets: hero game character 15-50k tris, prop 500-5k, background 50-500. A game car body usually sits in the hero range; wheels and parts are props.

## UVs
`bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)` in edit mode (may need a viewport; on failure use box projection in the material, see `materials.md`). Characters: mark seams on hidden edges (`edge.seam = True` in bmesh), then `bpy.ops.uv.unwrap()`.

## Bake detail back (Cycles)
1. `img = bpy.data.images.new("Low_Normal", 2048, 2048, is_data=True)`; an Image Texture node with it in the low mesh's material, set as the active node.
2. Select high, make low active; `scene.render.bake.use_selected_to_active = True`; `cage_extrusion` ~1-2% of object size.
3. `bpy.ops.object.bake(type="NORMAL")` (colour: `type="DIFFUSE"` with only the colour pass). `img.save_render(path)`.
4. Wire into a Normal Map node and compare previews of high and low.
