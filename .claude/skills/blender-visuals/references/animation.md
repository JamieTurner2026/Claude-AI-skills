# Animation

Source: MCP for Blender guide `animation` (MIT), adapted for `render.py`.

## Two ways with render.py
`render.py` calls `animate(i, total, args)` before each frame; it does not step the timeline itself.
1. **Simple motion (default):** set transforms in `animate()`, e.g. `obj.rotation_euler.z = 2*math.pi*i/total`.
2. **Keyframes (easing, overshoot, rigs):** key in `build()`, then step the timeline in `animate()`:
```python
def build(args):
    sc = bpy.context.scene; sc.frame_start, sc.frame_end = 1, 48; sc.render.fps = 24
    obj.location = (0, 0, 0); obj.keyframe_insert("location", frame=1)
    obj.location = (0, 0, 2); obj.keyframe_insert("location", frame=24)
    obj.rotation_euler.z = 3.1416; obj.keyframe_insert("rotation_euler", index=2, frame=48)
def animate(i, total, args):
    bpy.context.scene.frame_set(1 + i)
```
Pose bones: `pb = arm.pose.bones["hand.L"]; pb.rotation_mode = "XYZ"; pb.keyframe_insert("rotation_euler", frame=f)`. Bone keys are pose-space.

## Reaching fcurves (4.4 slotted actions, 5.0 removed Action.fcurves)
```python
def fcurves(obj):
    ad = obj.animation_data
    if not ad or not ad.action: return []
    if hasattr(ad, "action_slot"):
        from bpy_extras import anim_utils
        cb = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
        return list(cb.fcurves) if cb else []
    return list(ad.action.fcurves)
for fc in fcurves(obj):
    for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
```
`"BEZIER"` (with `kp.easing`) for natural moves, `"LINEAR"` for mechanical motion, `"CONSTANT"` for stepped.

## Making it feel alive
- Timing and spacing matter more than poses. Ease in and out of holds; linear for constant motion (wheels, conveyors, spindles).
- Anticipation before big moves, overshoot and settle after; follow-through on secondary parts 2-4 frames late.
- Arcs: limbs and thrown things travel on curves.
- Loops: first and last key identical and a Cycles modifier (`fc.modifiers.new("CYCLES")`), or render one frame fewer than the loop so the seam isn't doubled.
- Procedural: drivers (`obj.driver_add("rotation_euler", 2).driver.expression = "frame * 0.1"`) or a Noise modifier on an fcurve.

## Training-video motion (servo, pick-and-place, conveyor)
Linear for belts and rotating axes; ease in/out for servo moves between positions; hold a few frames at each stop so the viewer can read the state. Keep the camera still unless it shows something new.

## Organizing
- Push finished actions to NLA strips (`track = ad.nla_tracks.new(); track.strips.new(name, start, action)`) to sequence clips.
- Name actions `Door_Open`, `Car_Idle`; game engines import them by name.
- Camera moves: animate a parent empty, or a Track To constraint on a target empty. Change focal length slowly.

## Check motion
A single frame can't show motion. Render `--frames N` at preview size and Read the first, middle and last frames from `OUT/frames/`. Look for popping, interpenetration, sliding feet, and the loop seam.
