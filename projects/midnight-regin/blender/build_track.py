"""Build the Solaris Coast test block: a small night-time street circuit.

    python3 blender/build_track.py

A rounded-rectangle loop (about 1.0 km) with walls, kerbs, lane markings,
street lights, block-out buildings and checkpoint arches. Everything is at the
world origin so the Unreal import script places each mesh at (0, 0, 0).

Output: assets/export/track/SM_*.fbx + assets/export/track_layout.json
(checkpoints, player start and mesh list in Unreal coordinates).
"""
import math
import random
import sys
from pathlib import Path

import bpy  # noqa: F401  (must come before bmesh)
import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import mr_blender as mr  # noqa: E402

# Centreline half-extents, corner radius and road width, in cm.
HALF_X, HALF_Y, CORNER_R, ROAD_W = 20000, 12000, 6000, 1400
WALL_OFFSET = 1000
CHECKPOINT_COUNT = 6
GRID_SLOTS = 6
DEFAULT_LAPS = 3
SEED = 2026


def grid_slots():
    """Staggered starting grid on the bottom straight, behind the line. Blender coordinates, slot 0 is pole."""
    return [(-1000.0 - 800.0 * i, -HALF_Y + (250.0 if i % 2 == 0 else -250.0), 0.0) for i in range(GRID_SLOTS)]


def centreline(step=1000.0, corner_segments=16):
    """Points around the loop, counter-clockwise from the middle of the bottom straight.

    Returns a list of dicts: pos (x, y), normal (outward), heading_deg, corner (bool), s (distance along lap).
    """
    sx, sy = HALF_X - CORNER_R, HALF_Y - CORNER_R
    pts = []

    def straight(p0, p1, normal, heading):
        length = math.dist(p0, p1)
        n = max(1, round(length / step))
        for i in range(n):
            t = i / n
            pts.append({"pos": (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t),
                        "normal": normal, "heading_deg": heading, "corner": False})

    def arc(centre, start_deg):
        for i in range(corner_segments):
            a = math.radians(start_deg + 90.0 * i / corner_segments)
            pts.append({"pos": (centre[0] + CORNER_R * math.cos(a), centre[1] + CORNER_R * math.sin(a)),
                        "normal": (math.cos(a), math.sin(a)), "heading_deg": math.degrees(a) + 90.0, "corner": True})

    straight((0, -HALF_Y), (sx, -HALF_Y), (0, -1), 0)
    arc((sx, -sy), -90)
    straight((HALF_X, -sy), (HALF_X, sy), (1, 0), 90)
    arc((sx, sy), 0)
    straight((sx, HALF_Y), (-sx, HALF_Y), (0, 1), 180)
    arc((-sx, sy), 90)
    straight((-HALF_X, sy), (-HALF_X, -sy), (-1, 0), 270)
    arc((-sx, -sy), 180)
    straight((-sx, -HALF_Y), (0, -HALF_Y), (0, -1), 0)

    s = 0.0
    for i, p in enumerate(pts):
        p["s"] = s
        s += math.dist(p["pos"], pts[(i + 1) % len(pts)]["pos"])
    return pts, s


def _offset(p, d, z):
    return (p["pos"][0] + p["normal"][0] * d, p["pos"][1] + p["normal"][1] * d, z)


def _strip(bm, pts, d0, d1, z, mat, select=None, closed=True):
    """Flat ribbon between two offsets from the centreline (positive = outward)."""
    count = len(pts) if closed else len(pts) - 1
    for i in range(count):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        if select and not select(i, a, b):
            continue
        quad = [_offset(a, d0, z), _offset(a, d1, z), _offset(b, d1, z), _offset(b, d0, z)]
        bm.faces.new([bm.verts.new(q) for q in quad]).material_index = mat(i) if callable(mat) else mat


def _wall(bm, pts, d, thickness, height, mat_side, mat_top, cap_height=10):
    """Continuous wall following the loop, with a neon cap."""
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        for z0, z1, mat in ((0, height, mat_side), (height, height + cap_height, mat_top)):
            corners = [_offset(p, dd, z) for z in (z0, z1) for p, dd in ((a, d), (b, d), (b, d + thickness), (a, d + thickness))]
            v = [bm.verts.new(c) for c in corners]
            for q in ((0, 1, 5, 4), (2, 3, 7, 6), (4, 5, 6, 7)):
                bm.faces.new([v[k] for k in q]).material_index = mat


def build_ground(pts):
    bm = bmesh.new()
    _strip(bm, pts, -ROAD_W / 2, ROAD_W / 2, 0.0, 0)
    mr.add_box(bm, (0, 0, -8), (2 * HALF_X + 30000, 2 * HALF_Y + 30000, 10), 1)   # top at z = -3
    return mr.object_from_bmesh(bm, "SM_Track_Ground", ["M_MR_Asphalt", "M_MR_Ground"], smooth=False)


def build_markings(pts):
    """Visual only (no collision): neon edge lines, centre dashes, corner kerbs."""
    bm = bmesh.new()
    edge = ROAD_W / 2 - 40
    _strip(bm, pts, edge - 18, edge, 0.8, 0)
    _strip(bm, pts, -edge, -edge + 18, 0.8, 0)
    _strip(bm, pts, -8, 8, 0.8, 1, select=lambda i, a, b: not a["corner"] and i % 2 == 0)
    _strip(bm, pts, -ROAD_W / 2 - 90, -ROAD_W / 2, 1.0, lambda i: 2 if i % 2 else 1, select=lambda i, a, b: a["corner"])
    for k in range(14):                                   # start/finish line: two-row chequer at x = 0
        for row in range(2):
            if (k + row) % 2 == 0:
                y = -HALF_Y - ROAD_W / 2 + 50 + (k + 0.5) * (ROAD_W - 100) / 14
                mr.add_box(bm, (-50 + row * 100, y, 0.9), (100, (ROAD_W - 100) / 14, 0.4), 1)
    for gx, gy, _gz in grid_slots():                      # grid boxes: a front line and two short sides
        mr.add_box(bm, (gx + 260, gy, 0.9), (16, 230, 0.4), 1)
        for side in (-1, 1):
            mr.add_box(bm, (gx + 190, gy + side * 107, 0.9), (140, 16, 0.4), 1)
    return mr.object_from_bmesh(bm, "SM_Track_Markings", ["M_MR_NeonCyan", "M_MR_RoadLine", "M_MR_NeonPink"], smooth=False)


def build_barriers(pts):
    bm = bmesh.new()
    _wall(bm, pts, WALL_OFFSET, 40, 110, 0, 1)
    _wall(bm, pts, -WALL_OFFSET - 40, 40, 110, 0, 2)
    return mr.object_from_bmesh(bm, "SM_Track_Barriers", ["M_MR_Concrete", "M_MR_NeonPink", "M_MR_NeonCyan"], smooth=False)


def build_props(pts):
    """Street lights on the outside of the straights."""
    bm = bmesh.new()
    for i, p in enumerate(pts):
        if p["corner"] or i % 4:
            continue
        base = _offset(p, WALL_OFFSET + 120, 0)
        yaw = math.degrees(math.atan2(p["normal"][1], p["normal"][0]))
        mr.add_box(bm, (base[0], base[1], 400), (22, 22, 800), 0)
        arm = _offset(p, WALL_OFFSET - 20, 790)
        mr.add_box(bm, arm, (300, 14, 14), 0, rot_z_deg=yaw)
        head = _offset(p, WALL_OFFSET - 150, 778)
        mr.add_box(bm, head, (90, 30, 10), 1, rot_z_deg=yaw)
    for i, p in enumerate(pts):                           # glowing corner markers on top of the outer wall
        if p["corner"] and i % 2 == 0:
            yaw = math.degrees(math.atan2(p["normal"][1], p["normal"][0]))
            mr.add_box(bm, _offset(p, WALL_OFFSET + 20, 165), (12, 300, 70), 2, rot_z_deg=yaw)
    return mr.object_from_bmesh(bm, "SM_Track_Props", ["M_MR_Trim", "M_MR_Window", "M_MR_NeonPink"], smooth=False)


def build_start_gantry():
    """Start/finish gantry over the line at x = 0 on the bottom straight (built in place)."""
    bm = bmesh.new()
    span = WALL_OFFSET + 190
    y0 = -HALF_Y
    for s in (-1, 1):
        mr.add_box(bm, (0, y0 + s * span, 450), (90, 90, 900), 0)
        mr.add_box(bm, (-48, y0 + s * span, 450), (8, 30, 820), 1)
    mr.add_box(bm, (0, y0, 940), (110, 2 * span + 90, 120), 0)
    mr.add_box(bm, (-58, y0, 872), (8, 2 * span - 120, 14), 1)
    cols = 24
    width = (2 * span - 200) / cols
    for c in range(cols):                                 # chequered banner facing the grid
        for r in range(2):
            mr.add_box(bm, (-58, y0 - span + 100 + (c + 0.5) * width, 915 + r * 50), (6, width, 50), 2 if (c + r) % 2 == 0 else 0)
    return mr.object_from_bmesh(bm, "SM_Track_StartGantry", ["M_MR_Trim", "M_MR_NeonPink", "M_MR_RoadLine"], smooth=False)


def _clear_of_road(x, y, half, margin=2600):
    """True when a square footprint keeps `margin` away from the centreline."""
    sx, sy = HALF_X - CORNER_R, HALF_Y - CORNER_R
    qx, qy = abs(x) - sx, abs(y) - sy
    outside = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0)   # signed distance to the inner core
    return abs(outside - CORNER_R) > margin + half * 1.42


def build_buildings():
    """Block-out towers inside and around the loop with glowing bands."""
    rng = random.Random(SEED)
    bm = bmesh.new()
    cell = 5200
    footprints = []
    for gx in range(-7, 8):
        for gy in range(-6, 7):
            x, y = gx * cell + rng.uniform(-500, 500), gy * cell + rng.uniform(-500, 500)
            size = rng.uniform(2400, 4000)
            if abs(x) > HALF_X + 14000 or abs(y) > HALF_Y + 14000 or not _clear_of_road(x, y, size / 2):
                continue
            inside = abs(x) < HALF_X and abs(y) < HALF_Y
            height = rng.uniform(1800, 5200) if inside else rng.uniform(3000, 11000)
            mr.add_box(bm, (x, y, height / 2 - 3), (size, size, height), 0)
            band_mat = rng.choice((1, 1, 2, 3))
            bands = max(2, int(height // 900))
            for b in range(1, bands + 1):
                z = height * b / (bands + 1)
                mr.add_box(bm, (x, y, z), (size + 12, size + 12, 70 if band_mat == 1 else 30), band_mat)
            footprints.append({"x": x, "y": y, "size": size, "height": height})
    obj = mr.object_from_bmesh(bm, "SM_Track_Buildings", ["M_MR_Building", "M_MR_Window", "M_MR_NeonCyan", "M_MR_NeonPink"], smooth=False)
    return obj, footprints


def build_checkpoint_arch():
    """One arch, origin at ground centre, driven through along X. Placed per checkpoint in Unreal."""
    bm = bmesh.new()
    span = WALL_OFFSET + 20
    for s in (-1, 1):
        mr.add_box(bm, (0, s * span, 350), (60, 60, 700), 0)
        mr.add_box(bm, (0, s * (span - 34), 350), (20, 10, 640), 1)
    mr.add_box(bm, (0, 0, 730), (70, 2 * span + 60, 60), 0)
    mr.add_box(bm, (0, 0, 694), (24, 2 * span - 80, 12), 1)
    return mr.object_from_bmesh(bm, "SM_Checkpoint_Arch", ["M_MR_Trim", "M_MR_NeonCyan"], smooth=False)


def checkpoints(pts, lap_length):
    """Evenly spaced along the lap; index 0 is the start/finish line."""
    out = []
    for k in range(CHECKPOINT_COUNT):
        target = lap_length * k / CHECKPOINT_COUNT
        p = min(pts, key=lambda q: abs(q["s"] - target))
        out.append({"index": k, "blender_pos": (p["pos"][0], p["pos"][1], 0.0), "blender_yaw": p["heading_deg"] % 360})
    return out


def build():
    """Create every track mesh in the current scene. Returns (objects by name, layout dict)."""
    pts, lap_length = centreline()
    buildings, footprints = build_buildings()
    objs = {o.name: o for o in (build_ground(pts), build_markings(pts), build_barriers(pts), build_props(pts),
                                buildings, build_checkpoint_arch(), build_start_gantry())}
    cps = checkpoints(pts, lap_length)
    grid = grid_slots()
    start = (grid[-1][0], grid[-1][1], 60.0)            # the player starts at the back of the grid
    layout = {
        "units": "cm",
        "name": "Solaris Coast test block",
        "lap_length_cm": round(lap_length),
        "road_width_cm": ROAD_W,
        "wall_offset_cm": WALL_OFFSET,
        "half_extents_cm": [HALF_X, HALF_Y],
        "meshes": [
            {"name": "SM_Track_Ground", "fbx": "track/SM_Track_Ground.fbx", "collision": "complex", "place_at_origin": True},
            {"name": "SM_Track_Barriers", "fbx": "track/SM_Track_Barriers.fbx", "collision": "complex", "place_at_origin": True},
            {"name": "SM_Track_Buildings", "fbx": "track/SM_Track_Buildings.fbx", "collision": "complex", "place_at_origin": True},
            {"name": "SM_Track_Props", "fbx": "track/SM_Track_Props.fbx", "collision": "complex", "place_at_origin": True},
            {"name": "SM_Track_Markings", "fbx": "track/SM_Track_Markings.fbx", "collision": "none", "place_at_origin": True},
            {"name": "SM_Track_StartGantry", "fbx": "track/SM_Track_StartGantry.fbx", "collision": "complex", "place_at_origin": True},
            {"name": "SM_Checkpoint_Arch", "fbx": "track/SM_Checkpoint_Arch.fbx", "collision": "complex", "place_at_origin": False},
        ],
        "laps": DEFAULT_LAPS,
        "checkpoint_half_width_cm": WALL_OFFSET,
        "grid": [mr.to_unreal(slot, 0.0) for slot in grid],
        # Racing line for the AI: the centreline in driving order, Unreal coordinates.
        # radius_cm 0 means straight. Index 0 is the start/finish line.
        "racing_line": [{"x": round(p["pos"][0], 1), "y": round(-p["pos"][1], 1),
                         "radius_cm": CORNER_R if p["corner"] else 0} for p in pts],
        "player_start": mr.to_unreal(start, 0.0),
        "checkpoints": [{"index": c["index"], **mr.to_unreal(c["blender_pos"], c["blender_yaw"])} for c in cps],
        "building_count": len(footprints),
    }
    return objs, layout, cps


def main():
    mr.reset_scene()
    objs, layout, _cps = build()
    for name, obj in objs.items():
        out = mr.export_fbx(mr.EXPORT_DIR / "track" / f"{name}.fbx", [obj])
        print(f"OUTPUT {out}  ({mr.tri_count(obj)} tris)")
    for m in layout["meshes"]:
        m["triangles"] = mr.tri_count(objs[m["name"]])
        m["materials"] = [mat.name for mat in objs[m["name"]].data.materials]
    mr.write_json(mr.EXPORT_DIR / "track_layout.json", layout)
    print(f"lap {layout['lap_length_cm'] / 100:.0f} m, {layout['building_count']} buildings")


if __name__ == "__main__":
    main()
