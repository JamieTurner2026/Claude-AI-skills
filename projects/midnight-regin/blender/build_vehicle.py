"""Build a rigged, Unreal-ready vehicle from a JSON spec.

    python3 blender/build_vehicle.py [blender/specs/solaris_gt.json]

Output: assets/export/SK_<Name>.fbx (skeletal mesh) + assets/export/<id>.json (manifest).
The skeleton is Root + Phys_Wheel_FL/FR/BL/BR, the bone names expected by
UMRVehicleTuningData / AMRVehiclePawn. A new car is a new spec file.
"""
import json
import math
import sys
from pathlib import Path

import bpy  # must come before bmesh/mathutils
import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import mr_blender as mr  # noqa: E402
from lib import mr_parts  # noqa: E402

WHEEL_BONES = ("Phys_Wheel_FL", "Phys_Wheel_FR", "Phys_Wheel_BL", "Phys_Wheel_BR")
BODY_MATS = ["M_MR_Paint", "M_MR_Trim", "M_MR_Glass", "M_MR_LightFront", "M_MR_LightRear", "M_MR_NeonCyan", "M_MR_Rim"]
PAINT, TRIM, GLASS, LIGHT_F, LIGHT_R, NEON, RIM = range(7)


def load_spec(path):
    return json.loads(Path(path).read_text())


def wheel_layout(spec):
    """Bone name -> (centre in Blender cm, width, side). Left is +Y."""
    xf, xr = spec["wheelbase"] / 2, -spec["wheelbase"] / 2
    y, r = spec["track_half_width"], spec["wheel_radius"]
    fw, rw = spec["front_wheel_width"], spec["rear_wheel_width"]
    return {
        "Phys_Wheel_FL": ((xf, y, r), fw, 1),
        "Phys_Wheel_FR": ((xf, -y, r), fw, -1),
        "Phys_Wheel_BL": ((xr, y, r), rw, 1),
        "Phys_Wheel_BR": ((xr, -y, r), rw, -1),
    }


def _body_section(x, hw, zb, zt):
    h = zt - zb
    crown = 2.5
    pts = [(-0.80 * hw, zb), (0.80 * hw, zb), (hw, zb + 0.24 * h), (hw, zb + 0.70 * h), (0.90 * hw, zt),
           (0.45 * hw, zt + crown), (-0.45 * hw, zt + crown), (-0.90 * hw, zt), (-hw, zb + 0.70 * h), (-hw, zb + 0.24 * h)]
    return [(x, y, z) for y, z in pts]


def _cabin_section(x, hw, zb, zt):
    top = hw * 0.76
    pts = [(-hw, zb), (hw, zb), (hw * 0.97, zb + (zt - zb) * 0.35), (top, zt), (top * 0.5, zt + 1.5),
           (-top * 0.5, zt + 1.5), (-top, zt), (-hw * 0.97, zb + (zt - zb) * 0.35)]
    return [(x, y, z) for y, z in pts]


def _subdivided(obj, levels=2):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    return mr.apply_modifiers(obj)


def _build_body(spec):
    bm = bmesh.new()
    mr.loft(bm, [_body_section(*s) for s in spec["body_stations"]], PAINT)
    body = _subdivided(mr.object_from_bmesh(bm, "Body", BODY_MATS))

    # Dark sills / lower valance.
    for poly in body.data.polygons:
        if poly.center.z < 23:
            poly.material_index = TRIM

    # Wheel wells: one cutter per wheel, closed on the inside so the floor stays intact.
    bm = bmesh.new()
    well_r = spec["wheel_radius"] + 6
    for (cx, cy, cz), _width, side in wheel_layout(spec).values():
        inner, outer = side * (cy * side - 22), side * 120
        mr.lathe(bm, [(0.01, inner), (well_r, inner), (well_r, outer), (0.01, outer)], 28, TRIM)
        for v in bm.verts:
            if not v.tag:
                v.co.x += cx
                v.co.z += cz
                v.tag = True
    cutter = mr.object_from_bmesh(bm, "WellCutter", BODY_MATS, smooth=False)
    mod = body.modifiers.new("Wells", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    try:
        mod.material_mode = "INDEX"
    except Exception:
        pass
    mr.apply_modifiers(body)
    bpy.data.objects.remove(cutter)
    return body


def _build_cabin(spec):
    bm = bmesh.new()
    mr.loft(bm, [_cabin_section(*s) for s in spec["cabin_stations"]], GLASS)
    cabin = _subdivided(mr.object_from_bmesh(bm, "Cabin", BODY_MATS))
    roof_z = max(s[3] for s in spec["cabin_stations"]) - 9
    for poly in cabin.data.polygons:
        if poly.normal.z > 0.80 and poly.center.z > roof_z:
            poly.material_index = PAINT      # roof panel
    return cabin


def _build_details(spec):
    """Lights, underglow, mirrors, exhausts. Positions derive from the body stations."""
    st = spec["body_stations"]
    front_x, rear_x = st[-1][0], st[0][0]
    half_w = max(s[1] for s in st)
    bm = bmesh.new()
    for s in (-1, 1):
        mr.add_box(bm, (front_x - 21, s * 50, 52.5), (18, 34, 5), LIGHT_F)              # headlights
        mr.add_box(bm, (0, s * (half_w - 3), 12.5), (spec["wheelbase"] - 96, 3, 2.5), NEON)  # underglow
        mr.add_box(bm, (58, s * (half_w - 19), 86.5), (12, 22, 7), PAINT)               # mirrors
        mr.add_box(bm, (rear_x + 11, s * 42, 27), (14, 12, 6), RIM)                      # exhaust tips
    mr.add_box(bm, (rear_x + 6.5, 0, 69), (6, half_w * 1.62, 4), LIGHT_R)               # tail light bar
    mr.add_box(bm, (front_x - 9, 0, 27), (6, half_w * 1.1, 9), TRIM)                    # grille
    return mr.object_from_bmesh(bm, "Details", BODY_MATS, smooth=False)


def _build_armature(spec):
    arm_data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", arm_data)   # this exact name is dropped by Unreal's importer
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    root = arm_data.edit_bones.new("Root")
    root.head, root.tail = (0, 0, 0), (0, 0, 30)
    for name, (centre, _w, _s) in wheel_layout(spec).items():
        bone = arm_data.edit_bones.new(name)
        bone.head = centre
        bone.tail = (centre[0], centre[1], centre[2] + 20)
        bone.parent = root
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def build(spec, rigged=True):
    """Create the car in the current scene. Returns (armature or None, mesh object)."""
    parts = [_build_body(spec), _build_cabin(spec), _build_details(spec)]
    lip = mr_parts.build_spoiler("StockLip", "lip", width=140)
    lip.location = spec["sockets"]["spoiler"]
    parts.append(lip)
    for p in parts:
        mr.assign_all_to_group(p, "Root")

    for bone, (centre, width, side) in wheel_layout(spec).items():
        wheel = mr_parts.build_wheel(bone, spec["wheel_radius"], width, side, spec.get("wheel_design", "five_spoke"))
        wheel.location = centre
        mr.assign_all_to_group(wheel, bone)
        parts.append(wheel)

    name = "SK_" + spec["display_name"].replace(" ", "")
    mesh = mr.join(parts, name)
    paint = bpy.data.materials["M_MR_Paint"]
    paint.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = mr.hex_rgba(spec["colors"]["paint"])

    arm = None
    if rigged:
        arm = _build_armature(spec)
        mesh.parent = arm
        mod = mesh.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    return arm, mesh


def manifest(spec, mesh):
    lo, hi = mr.world_bounds([mesh])
    return {
        "id": spec["id"],
        "display_name": spec["display_name"],
        "fbx": f"{mesh.name}.fbx",
        "units": "cm",
        "forward_axis": "+X",
        "bones": ["Root", *WHEEL_BONES],
        "size_cm": [round(hi[i] - lo[i], 1) for i in range(3)],
        "triangles": mr.tri_count(mesh),
        "materials": [m.name for m in mesh.data.materials],
        "wheel_radius": spec["wheel_radius"],
        "wheel_widths": {"front": spec["front_wheel_width"], "rear": spec["rear_wheel_width"]},
        "wheels_unreal": {b: mr.to_unreal(c)["location"] for b, (c, _w, _s) in wheel_layout(spec).items()},
        "sockets_unreal": {k: mr.to_unreal(v)["location"] for k, v in spec["sockets"].items()},
    }


def main(spec_path):
    spec = load_spec(spec_path)
    mr.reset_scene()
    arm, mesh = build(spec)
    out = mr.export_fbx(mr.EXPORT_DIR / f"{mesh.name}.fbx", [arm, mesh], skeletal=True)
    info = manifest(spec, mesh)
    mr.write_json(mr.EXPORT_DIR / f"{spec['id']}.json", info)
    print(f"OUTPUT {out}  ({info['triangles']} tris, {info['size_cm']} cm)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "specs" / "solaris_gt.json")
