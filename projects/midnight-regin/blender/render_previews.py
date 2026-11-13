"""Render preview images of the generated assets into docs/previews.

    python3 blender/render_previews.py [car|parts|track|hero|all] [--quick]
"""
import math
import sys
from pathlib import Path

import bpy  # must come before bmesh/mathutils
import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_parts  # noqa: E402
import build_track  # noqa: E402
import build_vehicle  # noqa: E402
from lib import mr_blender as mr  # noqa: E402
from lib import mr_parts  # noqa: E402

SPEC = Path(__file__).parent / "specs" / "solaris_gt.json"


def _studio(quick):
    mr.setup_render(*( (640, 360, 16) if quick else (1280, 720, 64) ))
    mr.set_world("#1B2030", 0.9)
    mr.add_sun((50, 0, 35), 3.0)
    mr.add_sun((65, 0, -140), 1.2, "#88CCFF")
    bm = bmesh.new()
    mr.add_box(bm, (0, 0, -1), (6000, 6000, 2), 0)
    mr.object_from_bmesh(bm, "Floor", ["M_MR_Asphalt"], smooth=False)


def render_car(quick):
    mr.reset_scene()
    _arm, _mesh = build_vehicle.build(build_vehicle.load_spec(SPEC), rigged=False)
    _studio(quick)
    views = {
        "car_front_three_quarter": ((1.0, -0.75, 0.38), 760),
        "car_rear_three_quarter": ((-1.0, 0.8, 0.42), 760),
        "car_side": ((0.0, -1.0, 0.12), 800),
        "car_top": ((0.001, 0.0, 1.0), 900),
    }
    for name, (direction, dist) in views.items():
        cam = mr.add_camera((0, 0, 55), direction, dist)
        print("OUTPUT", mr.render(mr.PREVIEW_DIR / f"{name}.png"))
        bpy.data.objects.remove(cam)


def render_parts(quick):
    mr.reset_scene()
    x = 0.0
    for name, (_cat, _socket, builder) in build_parts.PARTS.items():
        obj = builder(name)
        # Wheels show their outer face; other parts are turned a little towards the camera.
        obj.rotation_euler = (0, 0, math.radians(205 if "Wheel" in name else 105))
        lo, hi = mr.world_bounds([obj])
        obj.location = (x - lo.x, -(lo.y + hi.y) / 2, -lo.z + (0 if "Wheel" in name else 12))
        x += (hi.x - lo.x) + 35.0
    _studio(quick)
    mr.add_sun((70, 0, -20), 4.0)
    bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 2.5
    mr.add_camera((x / 2 - 15, 0, 28), (0.1, -1.0, 0.5), 10000, ortho_scale=x * 1.08)
    print("OUTPUT", mr.render(mr.PREVIEW_DIR / "parts.png"))


def _night(quick, size=None):
    w, h, s = (640, 360, 16) if quick else (1280, 720, 96)
    mr.setup_render(w, h, s)
    mr.set_world("#0A1030", 0.35)
    mr.add_sun((55, 0, 30), 0.6, "#8FA8FF")


def _place_arches(objs, cps):
    arch = objs["SM_Checkpoint_Arch"]
    for c in cps:
        copy = arch.copy()
        bpy.context.collection.objects.link(copy)
        copy.location = c["blender_pos"]
        copy.rotation_euler = (0, 0, math.radians(c["blender_yaw"]))
    bpy.data.objects.remove(arch)


def render_track(quick):
    mr.reset_scene()
    objs, _layout, cps = build_track.build()
    _place_arches(objs, cps)
    _night(quick)
    mr.add_camera((0, 0, 0), (-0.25, -1.0, 0.75), 80000, fov_deg=38)
    print("OUTPUT", mr.render(mr.PREVIEW_DIR / "track_overview.png"))
    for o in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        bpy.data.objects.remove(o)
    mr.add_camera((0, 0, 0), (0.0001, 0.0, 1.0), 100000, ortho_scale=66000)
    print("OUTPUT", mr.render(mr.PREVIEW_DIR / "track_map.png"))


def render_hero(quick):
    """The car on the start straight, roughly as the chase camera will see it."""
    mr.reset_scene()
    objs, layout, cps = build_track.build()
    _place_arches(objs, cps)
    _arm, car = build_vehicle.build(build_vehicle.load_spec(SPEC), rigged=False)
    car.location = (-3000, -build_track.HALF_Y, 0)
    _night(quick)
    mr.add_camera((-2900, -build_track.HALF_Y, 95), (-1.0, -0.42, 0.30), 820, fov_deg=62)
    print("OUTPUT", mr.render(mr.PREVIEW_DIR / "hero_start_line.png"))


if __name__ == "__main__":
    what = next((a for a in sys.argv[1:] if not a.startswith("--")), "all")
    quick = "--quick" in sys.argv
    if what in ("car", "all"):
        render_car(quick)
    if what in ("parts", "all") and "render_parts" in globals():
        render_parts(quick)
    if what in ("track", "all") and "render_track" in globals():
        render_track(quick)
    if what in ("hero", "all") and "render_hero" in globals():
        render_hero(quick)
