"""Adjustable mount for an M18 barrel sensor (proximity/photo-eye): a plate with an 18.5 mm hole
and two slots so the sensor can slide toward or away from the target.
args: thickness=4 width=50 length=90 slot=25 (mm)
"""
from build123d import *


def build(args):
    t = float(args.get("thickness", 4)); w = float(args.get("width", 50))
    L = float(args.get("length", 90)); slot = float(args.get("slot", 25))
    with BuildPart() as p:
        with BuildSketch():
            RectangleRounded(L, w, radius=6)
            with Locations((L / 2 - 18, 0)):
                Circle(18.5 / 2, mode=Mode.SUBTRACT)                 # M18 sensor thread
            with Locations((-L / 2 + 22, w / 4), (-L / 2 + 22, -w / 4)):
                SlotOverall(slot, 6.5, mode=Mode.SUBTRACT)            # M6 adjustment slots
        extrude(amount=t)
        chamfer(p.edges().group_by(Axis.Z)[-1], length=0.5)          # break the top edges
    return p.part
