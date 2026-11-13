"""Reusable vehicle component builders (wheels, spoiler, bumpers).

Every builder returns a mesh object whose origin is its attach point:
  wheel            -> wheel centre, axle along Y, `side` = +1 for left (+Y outer face) or -1 for right
  spoiler          -> centre of the mounting surface on the boot lid
  front/rear bumper add-on -> centre of the bumper's lower edge
The same builders are used for the car itself and for the standalone
customization parts, so parts always fit.
"""
import math

import bpy  # noqa: F401  (must come before bmesh)
import bmesh

from . import mr_blender as mr

WHEEL_DESIGNS = ("five_spoke", "turbine")


def build_wheel(name, radius, width, side=1, design="five_spoke"):
    """Tyre + rim + spokes. Materials: 0 tyre, 1 rim, 2 trim (barrel/hub)."""
    bm = bmesh.new()
    hw = width / 2
    rim_r = radius * 0.68
    face_y = side * (hw - 2.5)      # spoke face, slightly recessed
    back_y = -side * (hw - 1.0)

    # Tyre: rounded shoulders.
    tyre = [(rim_r, -hw), (radius - 3.0, -hw), (radius, -hw + 3.0), (radius, hw - 3.0), (radius - 3.0, hw), (rim_r, hw)]
    mr.lathe(bm, tyre, 32, mat_index=0)
    # Rim lip + barrel + closed back.
    barrel = [(rim_r, side * hw), (rim_r - 1.5, side * hw), (rim_r - 2.5, face_y), (rim_r - 3.5, back_y), (0.01, back_y)]
    mr.lathe(bm, barrel, 32, mats=[1, 1, 2, 2])
    lip = [(rim_r, -side * hw), (rim_r - 3.5, back_y)]
    mr.lathe(bm, lip, 32, mat_index=2)
    # Hub.
    hub = [(0.01, face_y + side * 1.5), (radius * 0.16, face_y + side * 1.5), (radius * 0.18, face_y - side * 2.0)]
    mr.lathe(bm, hub, 16, mat_index=1)

    # Spokes (boxes in the XZ plane, rotated around the axle).
    count, spoke_w = (5, radius * 0.17) if design == "five_spoke" else (10, radius * 0.08)
    inner, outer = radius * 0.12, rim_r - 2.0
    length = outer - inner
    for i in range(count):
        ang = 2 * math.pi * i / count + (0.0 if design == "five_spoke" else 0.15)
        ca, sa = math.cos(ang), math.sin(ang)
        mid = inner + length / 2
        verts = []
        for dy in (-1.5, 1.5):
            for dr, dt in ((-length / 2, -spoke_w / 2), (length / 2, -spoke_w * 0.35), (length / 2, spoke_w * 0.35), (-length / 2, spoke_w / 2)):
                r, t = mid + dr, dt
                verts.append(bm.verts.new((r * ca - t * sa, face_y + dy, r * sa + t * ca)))
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            bm.faces.new([verts[k] for k in q]).material_index = 1

    return mr.object_from_bmesh(bm, name, ["M_MR_Tire", "M_MR_Rim", "M_MR_Trim"], sharp_angle_deg=35)


def build_spoiler(name, style="wing", width=150.0):
    """Rear spoiler. Origin = mount point on the boot lid. Materials: 0 paint, 1 trim."""
    bm = bmesh.new()
    if style == "lip":
        mr.loft(bm, [[(-8, y, 0), (6, y, 0), (4, y, 5), (-9, y, 7)] for y in (-width / 2, width / 2)], 0)
    else:
        height = 26.0
        for y in (-width * 0.33, width * 0.33):            # uprights
            mr.add_box(bm, (0, y, height / 2), (10, 2.5, height), 1)
        # Aerofoil section, swept across the full width.
        foil = [(-14, 0), (-6, 3.2), (6, 3.0), (14, 1.0), (14, 0.0), (4, -1.2), (-8, -0.8)]
        mr.loft(bm, [[(x, y, height + z) for x, z in foil] for y in (-width / 2, width / 2)], 0)
        for y in (-width / 2, width / 2):                    # end plates
            mr.add_box(bm, (0, y, height + 1.0), (32, 1.5, 14), 1)
    return mr.object_from_bmesh(bm, name, ["M_MR_Paint", "M_MR_Trim"], sharp_angle_deg=30)


def build_front_splitter(name, width=176.0):
    """Front bumper add-on: splitter blade with canards. Origin = centre of the bumper's lower edge."""
    bm = bmesh.new()
    outline = [(-30, 0), (4, 0), (12, 0.25), (16, 0.5)]     # (x, fraction of width tapered away)
    left = [(x, (width / 2) * (1 - t * 0.5)) for x, t in outline]
    pts_top = [(x, y, 2.5) for x, y in left] + [(x, -y, 2.5) for x, y in reversed(left)]
    pts_bot = [(x, y, 0.0) for x, y in left] + [(x, -y, 0.0) for x, y in reversed(left)]
    mr.loft(bm, [pts_bot, pts_top], 0)
    for y_sign in (-1, 1):                                    # canards
        mr.add_box(bm, (-4, y_sign * (width / 2 - 3), 9), (22, 1.5, 12), 0)
    return mr.object_from_bmesh(bm, name, ["M_MR_Trim"], sharp_angle_deg=30)


def build_rear_diffuser(name, width=150.0, fins=5):
    """Rear bumper add-on: diffuser plate with fins. Origin = centre of the bumper's lower edge."""
    bm = bmesh.new()
    mr.loft(bm, [[(-6, y, 10), (34, y, 0), (34, y, 2), (-6, y, 12.5)] for y in (-width / 2, width / 2)], 0)
    for i in range(fins):
        y = -width / 2 + width * (i + 0.5) / fins
        mr.loft(bm, [[(-6, yy, 10.5), (30, yy, 1.0), (30, yy, -4.0), (-6, yy, -2.0)] for yy in (y - 1, y + 1)], 0)
    return mr.object_from_bmesh(bm, name, ["M_MR_Trim"], sharp_angle_deg=30)
