---
name: cad-parts
description: Design exact, manufacturable mechanical parts as Python code with build123d (OpenCascade CAD) - brackets, mounts, plates, enclosures, spacers, jigs for servos, sensors and machine stations - and export STEP (CAD/CNC), STL (3D printing) and GLB (Blender renders). Use when the user wants a part with real millimetre dimensions, holes and slots, a printable or machinable model, or a precise part to show in a machine diagram or training render.
---

# CAD parts (build123d)

Claude writes a small part script; `scripts/build_part.py` builds it, exports the files and prints the part's numbers (size, volume, validity). Render it with `blender-visuals` and **look at it** before calling it done.

Use this for exact parts measured in millimetres. For game art, organic shapes or anything that will be textured and animated, use `blender-core` instead.

## Setup (once per machine)
```
bash scripts/setup_cad.sh          # own venv at $CAD_VENV or ~/.venvs/build123d; prints python=<path>
```
Needs Python 3.11-3.14 and about 900 MB. Run every script below with the printed `python=` path (written `PY` here). If the install fails, say so; don't fake output.

## Build and export
```
PY scripts/build_part.py PART.py --out OUT_DIR [--name NAME] [--formats step,stl,glb,obj] [--arg key=value ...]
```
`PART.py` defines `build(args)` and returns the part (`args` holds the `--arg` strings). It prints one JSON line with `bbox_mm`, `min_mm`, `volume_mm3`, `solids`, `faces`, `valid` and the files.

## Examples (`assets/examples/`)
| Part | File | Args |
|---|---|---|
| L-bracket for a standard hobby servo, M5 base holes | `servo_bracket.py` | `thickness= width= depth= height=` |
| Slotted plate for an M18 barrel sensor | `sensor_mount.py` | `thickness= width= length= slot=` |

Start from the closest example. API cheat sheet: [references/cheatsheet.md](references/cheatsheet.md).

## Workflow
1. Get the real numbers first: the part it holds (servo body, sensor thread, bolt size), clearances and material thickness. If they're missing, ask, or mark your values "(guess)".
2. Write `build(args)` with the key sizes as args. Put the part on the ground (z from 0 up), centred on X and Y.
3. Build it, then check the JSON:
   - `valid` is true and `solids` is 1, unless it is meant to be an assembly.
   - `bbox_mm` matches the intended size.
   - `volume_mm3` is close to a quick hand estimate. **A cut that missed leaves the volume unchanged**, so this check catches it.
4. Look at it: `python3 ../blender-visuals/scripts/render.py ../blender-visuals/assets/scenes/turntable.py --out OUT/look --arg model=OUT/NAME.glb --arg color=#b8bec6 --width 640 --height 360 --samples 16`, then read the PNG. Check that the holes and slots are where they should be and go all the way through.
5. Deliver the STEP (for CAD/CNC) and the STL (for printing), and give their sizes. For a machine diagram, import the GLB (it arrives at real size, in metres) with `import_model` in a `blender-visuals` scene.

## Pitfalls
- Units are millimetres in build123d. The GLB arrives in Blender in metres at true size; STL and STEP stay in mm.
- A cutting tool has to be longer than the material it cuts. Make it 2-3x the thickness and centred on the face, or it may cut nothing. Check the volume.
- Select edges with selectors, not indexes: `part.edges().filter_by(Axis.Z)` for vertical edges, `.group_by(Axis.Z)[-1]` for the top ones. Fillet before small details, and keep the radius smaller than the wall.
- Sheet metal (`BuildSheet`, `flange`, `unfold`) is only in the build123d development branch, not the released 0.13.0. Model bent brackets as solids for now.
- Clearance holes: M3 3.4, M4 4.5, M5 5.5, M6 6.6 mm (ISO medium). Mark them "(guess)" if the user's standard is unknown.
- Training and simulation parts only: never present a model as a certified drawing for real equipment.
