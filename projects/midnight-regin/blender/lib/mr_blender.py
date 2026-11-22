"""Shared helpers for the MIDNIGHT REIGN Blender asset pipeline.

Conventions (see docs/art-pipeline.md):
  * 1 Blender unit = 1 cm (scene unit scale 0.01) so FBX files import into
    Unreal at scale 1.0 with no scaled armature root.
  * Vehicles face +X, Z is up, left side is +Y in Blender (Unreal flips Y).
  * Material names are stable slot names (M_MR_*); Unreal replaces them with
    material instances of the same name.

Runs with the `bpy` Python module (pip install bpy) or inside Blender.
"""
import json
import math
from pathlib import Path

import bpy  # must come before bmesh/mathutils
import bmesh
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
EXPORT_DIR = REPO / "assets" / "export"
PREVIEW_DIR = REPO / "docs" / "previews"

# Palette taken from the Pygame prototype.
ASPHALT = "#19191E"
NEON_CYAN = "#00FFFF"
NEON_PINK = "#FF1493"

# name -> (colour, metallic, roughness, emission strength)
MATERIALS = {
    "M_MR_Paint": (NEON_PINK, 0.85, 0.28, 0.0),
    "M_MR_Glass": ("#0A1420", 0.6, 0.08, 0.0),
    "M_MR_Trim": ("#15151A", 0.2, 0.6, 0.0),
    "M_MR_Tire": ("#0B0B0D", 0.0, 0.9, 0.0),
    "M_MR_Rim": ("#C8CCD4", 1.0, 0.25, 0.0),
    "M_MR_LightFront": ("#DFFFFF", 0.0, 0.3, 12.0),
    "M_MR_LightRear": ("#FF2040", 0.0, 0.3, 10.0),
    "M_MR_NeonCyan": (NEON_CYAN, 0.0, 0.4, 8.0),
    "M_MR_NeonPink": (NEON_PINK, 0.0, 0.4, 8.0),
    "M_MR_Asphalt": (ASPHALT, 0.0, 0.45, 0.0),
    "M_MR_Ground": ("#101014", 0.0, 0.8, 0.0),
    "M_MR_RoadLine": ("#E8E8F0", 0.0, 0.5, 0.6),
    "M_MR_Concrete": ("#2A2A33", 0.0, 0.8, 0.0),
    "M_MR_Building": ("#14141C", 0.3, 0.5, 0.0),
    "M_MR_Window": ("#FFC870", 0.0, 0.4, 3.0),
}


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)) + (a,)


def reset_scene():
    """Empty scene in centimetre units."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.01
    return scene


def material(name, override_color=None):
    """Get or create one of the standard materials."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    color, metallic, roughness, emission = MATERIALS[name]
    color = override_color or color
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_rgba(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = hex_rgba(color)
        bsdf.inputs["Emission Strength"].default_value = emission
    mat.diffuse_color = hex_rgba(color)
    return mat


def object_from_bmesh(bm, name, mat_names, smooth=True, sharp_angle_deg=40.0):
    """Finish a bmesh into a linked object. Faces keep their material_index into mat_names."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    limit = math.radians(sharp_angle_deg)
    for f in bm.faces:
        f.smooth = smooth
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < limit
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat_name in mat_names:
        mesh.materials.append(material(mat_name))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def add_box(bm, center, size, mat_index=0, rot_z_deg=0.0):
    """Axis-aligned (optionally yawed) box added to bm."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    a = math.radians(rot_z_deg)
    ca, sa = math.cos(a), math.sin(a)
    verts = []
    for dz in (-sz, sz):
        for dx, dy in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            verts.append(bm.verts.new((cx + dx * ca - dy * sa, cy + dx * sa + dy * ca, cz + dz)))
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for q in quads:
        f = bm.faces.new([verts[i] for i in q])
        f.material_index = mat_index
    return verts


def loft(bm, sections, mat_index=0, cap=True):
    """Skin a list of closed point loops (equal length) into a closed solid."""
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            f = bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
            f.material_index = mat_index
    if cap:
        bm.faces.new(list(reversed(rings[0]))).material_index = mat_index
        bm.faces.new(rings[-1]).material_index = mat_index


def lathe(bm, profile, segments=32, mat_index=0, mats=None):
    """Revolve (radius, y) profile points around the Y axis. mats: optional material index per profile segment."""
    rings = []
    for r, y in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segments), y,
                                    r * math.sin(2 * math.pi * i / segments))) for i in range(segments)])
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(segments):
            j = (i + 1) % segments
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mats[k] if mats else mat_index


def apply_modifiers(obj):
    """Bake the modifier stack into the mesh without bpy.ops (works headless)."""
    dg = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    new_mesh.name = old.name
    bpy.data.meshes.remove(old)
    return obj


def join(objs, name):
    """Join mesh objects into one, keeping materials and vertex groups."""
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    out.data.name = name
    return out


def assign_all_to_group(obj, group_name):
    vg = obj.vertex_groups.new(name=group_name)
    vg.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def world_bounds(objs):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def export_fbx(path, objs, skeletal=False):
    """Export objects to an Unreal-ready FBX (centimetres, scale 1, no leaf bones, no animation)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"ARMATURE", "MESH"} if skeletal else {"MESH"},
        apply_unit_scale=True,
        global_scale=1.0,
        axis_forward="-Z",
        axis_up="Y",
        mesh_smooth_type="FACE",
        use_mesh_modifiers=True,
        add_leaf_bones=False,
        use_armature_deform_only=True,
        armature_nodetype="NULL",
        bake_anim=False,
        path_mode="AUTO",
    )
    return path


def to_unreal(location, yaw_deg=0.0):
    """Blender (cm, right-handed) -> Unreal (cm, left-handed): Y and yaw flip."""
    x, y, z = location
    return {"location": [round(x, 2), round(-y, 2), round(z, 2)], "yaw": round(-yaw_deg, 2)}


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")
    return path


# ---------------------------------------------------------------- rendering

def setup_render(width=960, height=540, samples=48):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Filmic" if "Filmic" in _view_transforms() else scene.view_settings.view_transform


def _view_transforms():
    prop = bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"]
    return [i.identifier for i in prop.enum_items]


def set_world(color="#05060C", strength=1.0):
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bpy.context.scene.world = world
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = hex_rgba(color)
    bg.inputs["Strength"].default_value = strength


def add_sun(rotation_deg, energy, color="#FFFFFF"):
    light = bpy.data.lights.new("Sun", "SUN")
    light.energy = energy
    light.color = hex_rgba(color)[:3]
    light.angle = math.radians(8)
    obj = bpy.data.objects.new("Sun", light)
    obj.rotation_euler = tuple(math.radians(a) for a in rotation_deg)
    bpy.context.collection.objects.link(obj)
    return obj


def add_camera(target, direction, distance, fov_deg=35, ortho_scale=None):
    data = bpy.data.cameras.new("Cam")
    data.clip_start = 5
    data.clip_end = 500000
    if ortho_scale:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    else:
        data.angle = math.radians(fov_deg)
    cam = bpy.data.objects.new("Cam", data)
    bpy.context.collection.objects.link(cam)
    target = Vector(target)
    cam.location = target + Vector(direction).normalized() * distance
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return path
