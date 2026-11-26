"""L-bracket holding a standard-size hobby servo (body ~40 x 20 mm), bolted down with two M5 screws.
args: thickness=5 width=80 depth=40 height=55 (mm)
"""
from build123d import *


def build(args):
    t = float(args.get("thickness", 5)); w = float(args.get("width", 80))
    d = float(args.get("depth", 40)); h = float(args.get("height", 55))
    base = fillet(Box(w, d, t, align=(Align.CENTER, Align.CENTER, Align.MIN)).edges().filter_by(Axis.Z), radius=4)
    upright = Pos(0, d / 2 - t / 2, 0) * Box(w, t, h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    part = base + upright
    window = Pos(0, d / 2 - t / 2, t + (h - t) / 2) * Box(41, t * 3, 21)        # servo body cut-out
    part -= window
    for x in (-24.5, 24.5):                                                        # servo ear screw holes
        part -= Pos(x, d / 2 - t / 2, t + (h - t) / 2) * Rot(90, 0, 0) * Cylinder(1.6, t * 3)
    for x in (-w / 2 + 10, w / 2 - 10):                                            # M5 clearance holes in base
        part -= Pos(x, -d / 4, 0) * Cylinder(2.75, t * 3)
    return part
