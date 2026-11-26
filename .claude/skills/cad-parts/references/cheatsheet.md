# build123d cheat sheet (verified on 0.13.0)

Condensed from the build123d docs (Apache-2.0, (c) Roger Maitland and contributors; original filed in `JDOLLA/SuperOS/raw/gamedev/blender-skills/build123d/`). Every name below was checked to exist in 0.13.0.

## Two styles
**Algebra (shortest for simple parts):** shapes are values; `+` union, `-` cut, `&` intersect; `Pos(x, y, z) * shape` moves, `Rot(x, y, z) * shape` rotates (degrees).
```python
from build123d import *
plate = Box(60, 40, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
plate -= Pos(20, 0, 0) * Cylinder(3.4 / 2, 20)                  # M3 clearance hole, longer than the plate
plate = fillet(plate.edges().filter_by(Axis.Z), radius=3)       # round the vertical corners
```
**Builder (best for sketch, then extrude):**
```python
with BuildPart() as p:
    with BuildSketch():
        RectangleRounded(90, 50, radius=6)
        with Locations((30, 0)):
            Circle(9.25, mode=Mode.SUBTRACT)
        with GridLocations(40, 20, 2, 2):
            Circle(2.2, mode=Mode.SUBTRACT)
    extrude(amount=4)
    chamfer(p.edges().group_by(Axis.Z)[-1], length=0.5)
part = p.part
```

## Shapes
- 3D: `Box(x, y, z)`, `Cylinder(r, h)`, `Sphere(r)`, `Cone(r1, r2, h)`, `Torus(R, r)`, `Wedge(...)`, `Hole(r, depth)`, `CounterBoreHole(r, cb_r, cb_depth)`, `CounterSinkHole(r, cs_r)`. The hole objects work inside `BuildPart`, drilling down from the current face/plane.
- 2D (inside `BuildSketch`): `Rectangle`, `RectangleRounded`, `Circle`, `Polygon(*pts)`, `RegularPolygon(r, n)`, `SlotOverall(length, width)`, `SlotCenterToCenter(dist, width)`, `Text("A", size)`.
- 1D (inside `BuildLine`): `Line`, `Polyline`, `RadiusArc`, `Spline`; close it, then `make_face()` in a sketch.
- `align=(Align.CENTER, Align.CENTER, Align.MIN)` puts the bottom on z=0.

## Operations
`extrude(amount=)`, `revolve(axis=Axis.Z)`, `loft()`, `sweep(path=)`, `fillet(edges, radius)`, `chamfer(edges, length)`, `mirror(about=Plane.YZ)`, `offset(amount=, openings=faces)` (shell a box into an enclosure), `split(bisect_by=Plane.XY)`, `section()`.

## Placing
`Locations((x, y), ...)`, `GridLocations(dx, dy, nx, ny)`, `PolarLocations(radius, count)`, `HexLocations(...)`. Sketch on other planes with `BuildSketch(Plane.XZ)` or `Plane.XY.offset(10)`. Plane normals: XY +Z, XZ -Y, YZ +X. When in doubt, check the volume after the cut.

## Selecting
`part.faces()`, `.edges()`, `.vertices()`, then:
- `.filter_by(Axis.Z)`: parallel to Z.
- `.sort_by(Axis.Z)[-1]`: the highest.
- `.group_by(Axis.Z)[-1]`: all at the top height.

Operators: `>` sort, `<<` / `>>` lowest/highest group, `|` filter.

## Assemblies and import
- `Compound(children=[a, b], label="Station")`; `part.label = "Bracket"`; `part.color = Color("steelblue")`. STEP keeps labels and colours.
- `RigidJoint` / `RevoluteJoint` connect parts at named points.
- `import_step(path)` / `import_stl(path)` bring in vendor parts (only from trusted sources).

## Export
`export_step(part, "x.step")`, `export_stl(part, "x.stl")`, `export_gltf(part, "x.glb", binary=True)`, `export_obj(part, "x.obj")`. 2D drawings: `ExportSVG` / `ExportDXF`.
