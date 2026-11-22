"""Checks on the exported assets: what Unreal and the C++ code rely on.

    pip install bpy pytest && pytest blender/tests

Run the build scripts first (build_vehicle.py, build_parts.py, build_track.py).
Each FBX is re-imported into an empty Blender scene and inspected.
"""
import json
import math
import re
from pathlib import Path

import bpy
import pytest
from io_scene_fbx import parse_fbx

REPO = Path(__file__).resolve().parents[2]
EXPORT = REPO / "assets" / "export"
SPEC = json.loads((REPO / "blender" / "specs" / "solaris_gt.json").read_text())
WHEEL_BONES = ["Phys_Wheel_FL", "Phys_Wheel_FR", "Phys_Wheel_BL", "Phys_Wheel_BR"]

pytestmark = pytest.mark.skipif(not (EXPORT / "SK_SolarisGT.fbx").exists(), reason="run the build scripts first")


def import_fbx(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(path))
    bpy.context.view_layer.update()
    return list(bpy.context.scene.objects)


def world_size(objs):
    pts = [o.matrix_world @ v.co for o in objs if o.type == "MESH" for v in o.data.vertices]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def fbx_global_setting(path, name):
    root, _version = parse_fbx.parse(str(path))
    settings = next(e for e in root.elems if e.id == b"GlobalSettings")
    props = next(e for e in settings.elems if e.id == b"Properties70")
    for p in props.elems:
        if p.props[0] == name.encode():
            return p.props[-1]
    raise KeyError(name)


def all_fbx():
    return sorted(EXPORT.rglob("*.fbx"))


@pytest.fixture(scope="module")
def car():
    objs = import_fbx(EXPORT / "SK_SolarisGT.fbx")
    arm = next(o for o in objs if o.type == "ARMATURE")
    mesh = next(o for o in objs if o.type == "MESH")
    # Snapshot everything we need: later imports reset the scene.
    lo, hi = world_size([mesh])
    groups = {g.index: g.name for g in mesh.vertex_groups}
    weights = {}
    per_group_x = {}
    for v in mesh.data.vertices:
        assert len(v.groups) == 1, "every vertex must be rigidly skinned to exactly one bone"
        name = groups[v.groups[0].group]
        weights[name] = weights.get(name, 0) + 1
        per_group_x.setdefault(name, []).append((mesh.matrix_world @ v.co))
    return {
        "bones": {b.name: (arm.matrix_world @ b.head_local, b.parent.name if b.parent else None) for b in arm.data.bones},
        "lo": lo, "hi": hi,
        "materials": [m.name for m in mesh.data.materials],
        "tris": sum(len(p.vertices) - 2 for p in mesh.data.polygons),
        "weights": weights,
        "group_points": per_group_x,
        "mesh_scale": tuple(mesh.matrix_world.to_scale()),
    }


def test_every_fbx_is_in_centimetres_with_z_up_conversion():
    assert len(all_fbx()) >= 14
    for path in all_fbx():
        assert fbx_global_setting(path, "UnitScaleFactor") == pytest.approx(1.0), path.name   # 1 unit = 1 cm
        assert fbx_global_setting(path, "UpAxis") == 1, path.name                              # Y-up file, converted by Unreal


def test_skeleton_matches_what_the_cpp_expects(car):
    assert set(car["bones"]) == {"Root", *WHEEL_BONES}
    assert car["bones"]["Root"][1] is None
    for name in WHEEL_BONES:
        assert car["bones"][name][1] == "Root"
    # The same names are the defaults in the Unreal code.
    for src in ("Vehicles/MRVehicleTuningData.h", "Vehicles/MRVehiclePawn.cpp"):
        text = (REPO / "unreal/MidnightReign/Source/MidnightReign" / src).read_text()
        for name in WHEEL_BONES:
            assert f'TEXT("{name}")' in text, f"{name} missing from {src}"


def test_wheel_bones_sit_at_the_wheel_centres(car):
    # Re-imported scene is in metres (importer applies the cm unit scale).
    r = SPEC["wheel_radius"] / 100
    half_base, half_track = SPEC["wheelbase"] / 200, SPEC["track_half_width"] / 100
    expected = {"Phys_Wheel_FL": (half_base, half_track), "Phys_Wheel_FR": (half_base, -half_track),
                "Phys_Wheel_BL": (-half_base, half_track), "Phys_Wheel_BR": (-half_base, -half_track)}
    for name, (x, y) in expected.items():
        head = car["bones"][name][0]
        assert head.x == pytest.approx(x, abs=0.005)
        assert head.y == pytest.approx(y, abs=0.005)
        assert head.z == pytest.approx(r, abs=0.005)
        # ... and the vertices skinned to it are a wheel of the right radius around it.
        pts = car["group_points"][name]
        radius = max(math.hypot(p.x - head.x, p.z - head.z) for p in pts)
        assert radius == pytest.approx(r, abs=0.005)


def test_car_size_orientation_and_ground_contact(car):
    length, width, height = (car["hi"][i] - car["lo"][i] for i in range(3))
    assert 4.2 < length < 4.7 and 1.8 < width < 2.0 and 1.1 < height < 1.35   # metres after import
    assert length > width > height                       # long axis is X: the car faces along X
    assert car["lo"][2] == pytest.approx(0.0, abs=0.005)  # tyres touch z = 0
    # Front is +X: headlights are ahead of the tail lights.
    assert abs(car["hi"][0] + car["lo"][0]) < 0.05        # centred on the origin
    assert all(s == pytest.approx(car["mesh_scale"][0]) for s in car["mesh_scale"])


def test_car_materials_and_budget(car):
    assert {"M_MR_Paint", "M_MR_Glass", "M_MR_Tire", "M_MR_Rim", "M_MR_LightFront", "M_MR_LightRear", "M_MR_NeonCyan"} <= set(car["materials"])
    assert all(m.startswith("M_MR_") for m in car["materials"])
    assert car["tris"] < 20000
    assert car["weights"]["Root"] > 1000
    for name in WHEEL_BONES:
        assert car["weights"][name] > 100


def test_wheel_dimensions_match_cpp_defaults():
    text = (REPO / "unreal/MidnightReign/Source/MidnightReign/Vehicles/MRWheels.cpp").read_text()
    radii = [float(v) for v in re.findall(r"WheelRadius = ([\d.]+)f", text)]
    widths = [float(v) for v in re.findall(r"WheelWidth = ([\d.]+)f", text)]
    assert radii == [SPEC["wheel_radius"]] * 2
    assert widths == [SPEC["front_wheel_width"], SPEC["rear_wheel_width"]]


def test_vehicle_manifest():
    info = json.loads((EXPORT / "solaris_gt.json").read_text())
    assert info["bones"] == ["Root", *WHEEL_BONES]
    assert info["wheels_unreal"]["Phys_Wheel_FL"][1] < 0 < info["wheels_unreal"]["Phys_Wheel_FR"][1]   # Unreal: left is -Y
    assert info["wheels_unreal"]["Phys_Wheel_FL"][0] > 0 > info["wheels_unreal"]["Phys_Wheel_BL"][0]
    assert set(info["sockets_unreal"]) >= {"spoiler", "front_bumper", "rear_bumper"}


def test_parts_are_single_static_meshes_with_sane_origins():
    parts = json.loads((EXPORT / "parts.json").read_text())["parts"]
    assert {p["category"] for p in parts} == {"wheel", "spoiler", "front_bumper", "rear_bumper"}
    for part in parts:
        objs = import_fbx(EXPORT / part["fbx"])
        meshes = [o for o in objs if o.type == "MESH"]
        assert len(meshes) == 1 and not [o for o in objs if o.type == "ARMATURE"], part["name"]
        lo, hi = world_size(meshes)
        assert abs(lo[1] + hi[1]) < 0.02 or part["category"] == "wheel", f"{part['name']} not centred across the car"
        if part["category"] == "wheel":
            assert max(-lo[0], hi[0], -lo[2], hi[2]) == pytest.approx(0.36, abs=0.005)   # origin at the axle
        if part["category"] == "spoiler":
            assert lo[2] == pytest.approx(0.0, abs=0.01)                                  # sits on the mount point
        assert part["triangles"] < 3000
        assert all(m.startswith("M_MR_") for m in part["materials"])


def test_track_layout_and_meshes():
    layout = json.loads((EXPORT / "track_layout.json").read_text())
    half_x, half_y = layout["half_extents_cm"]
    assert 900 < layout["lap_length_cm"] / 100 < 1500
    assert len(layout["checkpoints"]) == 6
    assert layout["checkpoints"][0]["location"] == [0.0, float(half_y), 0.0]     # start line, Unreal Y is flipped
    for cp in layout["checkpoints"]:
        x, y, _z = cp["location"]
        assert abs(x) <= half_x + 1 and abs(y) <= half_y + 1
    start = layout["player_start"]
    assert start["yaw"] == 0 and start["location"][0] < 0                         # on the straight, before the line
    assert start["location"][:2] == layout["grid"][-1]["location"][:2]            # the player takes the last grid slot
    for mesh in layout["meshes"]:
        assert (EXPORT / mesh["fbx"]).exists()
        assert mesh["triangles"] < 30000
    assert {m["name"]: m["collision"] for m in layout["meshes"]}["SM_Track_Markings"] == "none"

    ground = [o for o in import_fbx(EXPORT / "track/SM_Track_Ground.fbx") if o.type == "MESH"]
    lo, hi = world_size(ground)
    assert hi[2] == pytest.approx(0.0, abs=0.001)                # road surface at z = 0
    assert hi[0] - lo[0] > 2 * half_x / 100                      # ground reaches beyond the loop


def _distance_to_centreline(layout, x, y):
    half_x, half_y = layout["half_extents_cm"]
    corner_r = max(p["radius_cm"] for p in layout["racing_line"])
    qx, qy = abs(x) - (half_x - corner_r), abs(y) - (half_y - corner_r)
    signed = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0)
    return abs(signed - corner_r)


def test_racing_line_grid_and_checkpoints_are_on_the_road():
    layout = json.loads((EXPORT / "track_layout.json").read_text())
    line = layout["racing_line"]
    half_road = layout["road_width_cm"] / 2
    assert len(line) > 60 and layout["laps"] == 3

    # Closed loop on the centreline, evenly enough spaced for the AI's look-ahead, same length as the lap.
    length = 0.0
    for a, b in zip(line, line[1:] + line[:1]):
        step = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        assert 300 < step < 1100
        length += step
        assert _distance_to_centreline(layout, a["x"], a["y"]) < 1.0
    assert length == pytest.approx(layout["lap_length_cm"], rel=0.001)
    assert (line[0]["x"], line[0]["y"]) == tuple(layout["checkpoints"][0]["location"][:2])
    assert line[1]["x"] > line[0]["x"]                    # driven towards +X from the line, like the grid faces
    assert {p["radius_cm"] for p in line} == {0, 6000}

    # Every checkpoint sits on a racing-line point, in driving order.
    indices = []
    for cp in layout["checkpoints"]:
        matches = [i for i, p in enumerate(line) if abs(p["x"] - cp["location"][0]) < 1 and abs(p["y"] - cp["location"][1]) < 1]
        assert len(matches) == 1
        indices.append(matches[0])
    assert indices == sorted(indices) and indices[0] == 0
    assert layout["checkpoint_half_width_cm"] > half_road

    # Grid: six distinct slots on the road, behind the line, pole position closest to it.
    grid = [g["location"] for g in layout["grid"]]
    assert len(grid) == 6 and len({tuple(g) for g in grid}) == 6
    xs = [g[0] for g in grid]
    assert xs == sorted(xs, reverse=True) and xs[0] < -500
    for (x, y, _z), g in zip(grid, layout["grid"]):
        assert _distance_to_centreline(layout, x, y) < half_road - 300   # room for a 1.9 m wide car
        assert g["yaw"] == 0
    for a, b in zip(grid, grid[1:]):
        assert a[0] - b[0] >= 700                         # a car length plus a gap between rows


def test_buildings_and_walls_keep_clear_of_the_road():
    layout = json.loads((EXPORT / "track_layout.json").read_text())
    half_x, half_y = (v / 100 for v in layout["half_extents_cm"])
    corner_r, half_road = 60.0, layout["road_width_cm"] / 200

    def distance_to_centreline(x, y):
        qx, qy = abs(x) - (half_x - corner_r), abs(y) - (half_y - corner_r)
        signed = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0)
        return abs(signed - corner_r)

    overhead = 4.5    # metres: anything this high is clear of every vehicle
    for name, clearance in (("SM_Track_Buildings", half_road + 3.0), ("SM_Track_Barriers", half_road + 2.0),
                            ("SM_Track_Props", half_road + 1.0), ("SM_Track_StartGantry", half_road + 2.0)):
        mesh = next(o for o in import_fbx(EXPORT / f"track/{name}.fbx") if o.type == "MESH")
        points = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
        # Only the start gantry is meant to span the road, and only above vehicle height.
        low = [p for p in points if name != "SM_Track_StartGantry" or p.z < overhead]
        nearest = min(distance_to_centreline(p.x, p.y) for p in low)
        assert nearest >= clearance, f"{name} comes within {nearest:.1f} m of the centreline at road level"
        if name == "SM_Track_StartGantry":
            assert min(p.z for p in points if distance_to_centreline(p.x, p.y) < half_road) > overhead, \
                "gantry crosses the road below vehicle height"
