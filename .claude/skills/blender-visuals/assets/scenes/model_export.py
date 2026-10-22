"""Build a simple model and export it (use render.py --export part.glb|.obj|.stl; no camera needed).
args: shape=cube|sphere|cylinder|torus|cone  size=1.0"""
import bpy
from lib.bl_helpers import *


def build(args):
    s = float(args.get("size", 1.0))
    add_primitive(args.get("shape", "cylinder"), scale=(s, s, s), color=args.get("color", "#8899aa"))
