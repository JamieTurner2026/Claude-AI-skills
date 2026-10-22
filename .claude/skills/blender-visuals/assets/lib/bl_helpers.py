"""Small helpers for scene scripts. Import with:  from lib.bl_helpers import *"""
import math
import bpy
from mathutils import Vector


def hex_rgba(h, a=1.0):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (a,)


def material(name, color="#cccccc", metallic=0.0, roughness=0.5, emission=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_rgba(color)
    b.inputs["Metallic"].default_value = metallic; b.inputs["Roughness"].default_value = roughness
    if emission:
        b.inputs["Emission Color"].default_value = hex_rgba(color); b.inputs["Emission Strength"].default_value = emission
    return m


def assign(obj, mat):
    obj.data.materials.clear(); obj.data.materials.append(mat); return obj


def set_background(color="#101418", strength=1.0):
    w = bpy.data.worlds.new("World"); w.use_nodes = True; bpy.context.scene.world = w
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = hex_rgba(color); bg.inputs["Strength"].default_value = strength


def add_lights(energy=3.0):
    sun = bpy.data.lights.new("Key", "SUN"); sun.energy = energy
    o = bpy.data.objects.new("Key", sun); o.rotation_euler = (math.radians(50), 0, math.radians(35)); bpy.context.collection.objects.link(o)
    fill = bpy.data.lights.new("Fill", "AREA"); fill.energy = 200; fill.size = 6
    f = bpy.data.objects.new("Fill", fill); f.location = (-5, -4, 4); bpy.context.collection.objects.link(f)


def bounds(objs):
    bpy.context.view_layer.update()  # text/curve bounds are only valid after an update
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type in {"MESH", "FONT", "CURVE"} for c in o.bound_box]
    if not pts: return Vector((0, 0, 0)), 1.0
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, max((hi - lo).length, 0.001)


def add_camera_fit(objs=None, direction=(1.0, -1.2, 0.8), fov_deg=40, margin=1.15):
    """Camera that frames `objs` (default: all meshes) from `direction`, always looking at their centre."""
    objs = objs or list(bpy.context.scene.objects)
    center, size = bounds(objs)
    cam_data = bpy.data.cameras.new("Cam"); cam_data.angle = math.radians(fov_deg)
    cam = bpy.data.objects.new("Cam", cam_data); bpy.context.collection.objects.link(cam)
    dist = (size / 2) / math.tan(cam_data.angle / 2) * margin
    cam.location = center + Vector(direction).normalized() * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam; return cam


def add_text(body, location=(0, 0, 0), size=0.5, color="#ffffff", rotation=(0, 0, 0), align="CENTER"):
    c = bpy.data.curves.new("txt", "FONT"); c.body = body; c.size = size; c.align_x = align; c.extrude = 0.01
    o = bpy.data.objects.new("txt", c); o.location = location; o.rotation_euler = rotation
    bpy.context.collection.objects.link(o); assign(o, material("txt_" + body[:8], color, roughness=0.4, emission=1.0))
    o.visible_shadow = False; return o


def add_primitive(kind, location=(0, 0, 0), scale=(1, 1, 1), color="#8899aa", **kw):
    ops = {"cube": bpy.ops.mesh.primitive_cube_add, "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
           "cylinder": bpy.ops.mesh.primitive_cylinder_add, "torus": bpy.ops.mesh.primitive_torus_add,
           "cone": bpy.ops.mesh.primitive_cone_add, "monkey": bpy.ops.mesh.primitive_monkey_add}
    ops[kind](location=location, **kw); o = bpy.context.active_object; o.scale = scale
    if kind in {"sphere", "torus", "monkey"}: bpy.ops.object.shade_smooth()
    assign(o, material(kind, color, metallic=0.2, roughness=0.45)); return o


def import_model(path):
    p = path.lower()
    before = set(bpy.data.objects)
    if p.endswith((".glb", ".gltf")): bpy.ops.import_scene.gltf(filepath=path)
    elif p.endswith(".obj"): bpy.ops.wm.obj_import(filepath=path)
    elif p.endswith(".stl"): bpy.ops.wm.stl_import(filepath=path)
    else: raise ValueError("supported imports: .glb .gltf .obj .stl")
    return [o for o in bpy.data.objects if o not in before]


def link_between(a, b, radius=0.05, color="#e0b040"):
    """Cylinder from point a to point b (Vectors/tuples)."""
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object; o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    assign(o, material("link", color, roughness=0.3)); return o
