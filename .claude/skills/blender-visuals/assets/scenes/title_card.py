"""Title card / label image. args: title="..."  subtitle="..."  bg=#hex  color=#hex"""
import math
import bpy
from lib.bl_helpers import *


def build(args):
    set_background(args.get("bg", "#0b1020"), 1.0); add_lights(2.0)
    add_text(args.get("title", "Title"), (0, 0.3, 0), size=1.0, color=args.get("color", "#ffffff"), rotation=(math.pi / 2, 0, 0))
    if "subtitle" in args: add_text(args["subtitle"], (0, 0.3, -1.1), size=0.45, color="#9fb3d9", rotation=(math.pi / 2, 0, 0))
    objs = [o for o in bpy.context.scene.objects if o.type == "FONT"]
    add_camera_fit(objs, direction=(0, -1, 0.05), margin=1.5)
