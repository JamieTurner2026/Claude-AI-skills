"""3D equipment/station diagram from a JSON spec.  args: spec=path.json
spec: {"title": "...", "nodes":[{"id":"sensor","label":"Sensor","kind":"cube|cylinder|sphere","pos":[x,y,z],"size":[x,y,z],"color":"#hex"}],
       "links":[{"from":"sensor","to":"servo","color":"#hex"}]}
Labels float above each node. Good for line/station/component diagrams from video-knowledge entries."""
import json, math
import bpy
from lib.bl_helpers import *


def build(args):
    spec = json.load(open(args["spec"]))
    set_background(spec.get("bg", "#10151c")); add_lights(3.0)
    nodes = {}
    for n in spec["nodes"]:
        sx, sy, sz = n.get("size", [1, 1, 1])
        o = add_primitive(n.get("kind", "cube"), tuple(n["pos"]), (sx / 2, sy / 2, sz / 2), n.get("color", "#6f8fb5"))
        nodes[n["id"]] = o
        add_text(n.get("label", n["id"]), (n["pos"][0], n["pos"][1], n["pos"][2] + sz / 2 + 0.45), 0.35, "#ffffff", (math.pi / 2, 0, 0))
    for l in spec.get("links", []):
        link_between(nodes[l["from"]].location, nodes[l["to"]].location, 0.05, l.get("color", "#e0b040"))
    if spec.get("title"):
        ys = [o.location.y for o in nodes.values()]; zs = [o.location.z for o in nodes.values()]
        add_text(spec["title"], (sum(o.location.x for o in nodes.values()) / len(nodes), max(ys) + 1.5, max(zs) + 3), 0.6, "#f0c060", (math.pi / 2, 0, 0))
    add_camera_fit(direction=(0.6, -1.4, 0.9), margin=1.2)
