# Rigging

Source: MCP for Blender guide `rigging` (MIT), adapted. Headless note: Rigify's metarig operator wants a 3D viewport, so it may fail under pip `bpy`; mechanical rigs built from data work everywhere.

## Before rigging
- Applied scale and rotation, at the origin on the ground, facing -Y (Blender's front).
- Merge duplicate vertices (`bmesh.ops.remove_doubles`) and remove loose parts; generated meshes are often many disconnected islands, which breaks automatic weights.
- Characters rig best in A-pose or T-pose with slight bends at elbows and knees.

## Mechanical rigs (robots, servo arms, doors, wheels): use this first
Rigid parts don't need skinning. Either parent parts to each other (`child.parent = parent`, then rotate the parent) or to bones:
```python
arm_data = bpy.data.armatures.new("Rig"); rig = bpy.data.objects.new("Rig", arm_data)
bpy.context.scene.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
root = arm_data.edit_bones.new("root"); root.head = (0, 0, 0); root.tail = (0, 0.3, 0)
b = arm_data.edit_bones.new("arm"); b.head = (0, 0, 1); b.tail = (0, 0, 2); b.parent = root
bpy.ops.object.mode_set(mode="OBJECT")
part.parent = rig; part.parent_type = "BONE"; part.parent_bone = "arm"
```
Pose with `rig.pose.bones["arm"].rotation_euler`, key it, and render (see `animation.md`). Plain object parenting plus pivots (set each part's origin at its joint) is often enough for a training diagram.

## Humanoids: Rigify (needs a viewport; best on the PC)
`addon_utils.enable("rigify", default_set=True)`, `bpy.ops.object.armature_human_metarig_add()`, fit the metarig's edit bones to the mesh joints, `bpy.ops.pose.rigify_generate()`, then skin to the generated `rig`, not the metarig.

## Skinning
Select the mesh, make the armature active, `bpy.ops.object.parent_set(type="ARMATURE_AUTO")`.
If "Bone Heat Weighting: failed to find solution": merge by distance and remove interior faces; or skin a voxel-remeshed copy and transfer weights with a Data Transfer modifier; or scale everything up 10x, skin, scale back.

## Verify
- Every vertex in some deform bone's group, every deform bone has a group: print counts from `obj.vertex_groups` and `obj.data.vertices[i].groups`.
- Pose it (`pb.rotation_mode = "XYZ"; pb.rotation_euler.x = 1.2`), render front and side previews, and check elbows, shoulders, knees, hips for collapse. Reset: `for pb in rig.pose.bones: pb.matrix_basis.identity()`.
