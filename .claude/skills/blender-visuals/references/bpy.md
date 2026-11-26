# Writing bpy that works on any Blender

Source: MCP for Blender guide `bpy` (MIT), adapted. Headless: `bpy` from pip or `blender -b`; print `bpy.app.version` before using anything version-specific.

## Look things up instead of guessing
```python
[i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]  # enum values
[p.identifier for p in bpy.types.ShaderNodeTexSky.bl_rna.properties]                     # properties of a type
[(p.identifier, p.type) for p in bpy.ops.mesh.primitive_cube_add.get_rna_type().properties]  # operator args
tree = bpy.data.node_groups.new("_probe", "ShaderNodeTree")                              # a node's sockets
n = tree.nodes.new("ShaderNodeMix"); n.data_type = "RGBA"
print([(i, s.name, s.type) for i, s in enumerate(n.inputs) if s.enabled]); bpy.data.node_groups.remove(tree)
```

## Portability rules
- Find nodes by `type`, never by name (names are localized): `next(n for n in nodes if n.type == "BSDF_PRINCIPLED")`. `bl_helpers.material()` does this.
- Principled BSDF inputs renamed in 4.0 (`Emission Color`, `Subsurface Weight`, `Specular IOR Level`, `Coat Weight`, `Sheen Weight`, `Transmission Weight`): `node.inputs.get("Emission Color") or node.inputs.get("Emission")`.
- Don't hardcode enums. `scene.render.engine`: assign in `try/except TypeError` (the error lists valid values). EEVEE is `BLENDER_EEVEE_NEXT` in 4.2-4.x, `BLENDER_EEVEE` before and after; `render.py` handles this.
- Material colours live on shader node inputs; `material.diffuse_color` only drives the solid viewport. In 5.0+ `use_nodes` is always on.
- Animation: 4.4 added slotted actions, 5.0 removed `Action.fcurves`. Key with `obj.keyframe_insert("location", frame=f)`; reach fcurves as in `animation.md`.

## Data API over operators
Prefer `bpy.data` and object properties: no context needed, faster. `bpy.data.meshes.new` + `from_pydata`, `bmesh` for edits, `obj.modifiers.new`, `obj.matrix_world`.
When an operator is needed headless: there is no 3D viewport, so viewport-only operators (`shade_smooth` in some versions, `smart_project`, Rigify metarig add) may fail. Prefer the data equivalent (`for p in mesh.polygons: p.use_smooth = True`). For operators that act on selection: `obj.select_set(True)`; `bpy.context.view_layer.objects.active = obj`. `mode_set` needs an active, visible object; always return to OBJECT mode in `try/finally`.

## Working style
- Small steps; `print` what you need to know.
- Name everything you create. One collection per logical group.
- Apply scale before rigging, scale-dependent modifiers, or export.
- Duplicate with `obj.copy()` (shares mesh, cheap) for repeats; `obj.data.copy()` only when the copy must differ.
- Units are metres: door ~2.1 m, table 0.75 m, person 1.7 m.
