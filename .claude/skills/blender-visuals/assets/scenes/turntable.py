"""Rotating showcase of an object. args: model=path.glb|obj|stl  OR  shape=cube|sphere|torus|monkey|cone  color=#hex  bg=#hex
Render: render.py scenes/turntable.py --out out --frames 48 --mp4 [--arg shape=monkey]"""
import math
import bpy
from lib.bl_helpers import *

_state = {}


def build(args):
    set_background(args.get("bg", "#0f1318")); add_lights()
    if "model" in args: objs = import_model(args["model"])
    else: objs = [add_primitive(args.get("shape", "monkey"), color=args.get("color", "#4f8cff"))]
    for o in objs:
        if o.type == "MESH" and not o.data.materials: assign(o, material("m", args.get("color", "#9aa7b8"), roughness=0.4))
    pivot = bpy.data.objects.new("pivot", None); bpy.context.collection.objects.link(pivot)
    center, _ = bounds(objs); pivot.location = center
    for o in objs:
        if o.parent is None: o.parent = pivot; o.matrix_parent_inverse = pivot.matrix_world.inverted()
    add_camera_fit(objs); _state["pivot"] = pivot


def animate(frame, total, args):
    _state["pivot"].rotation_euler[2] = 2 * math.pi * frame / total
