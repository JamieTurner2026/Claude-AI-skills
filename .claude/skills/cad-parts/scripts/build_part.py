#!/usr/bin/env python3
"""Build a CAD part from a script and export it; prints one JSON result.

Run with the build123d venv python (see setup_cad.sh):
  PY scripts/build_part.py PART.py --out DIR [--name part] [--formats step,stl,glb] [--arg key=value ...]

PART.py defines build(args) -> a build123d Part/Solid/Compound (args: dict of --arg strings).
Units are millimetres. Exports: step (CAD/CNC), stl (3D printing), glb (Blender, web), obj.
The JSON lists the bounding box (mm), volume (mm^3), solid/face counts, validity and files.
Check the volume against a hand estimate: a cut that missed leaves the volume unchanged.
"""
import argparse
import json
import os
import runpy
import sys


def main():
    p = argparse.ArgumentParser()
    p.add_argument("part"); p.add_argument("--out", required=True); p.add_argument("--name", default=None)
    p.add_argument("--formats", default="step,stl,glb"); p.add_argument("--arg", action="append", default=[])
    a = p.parse_args()
    import build123d as bd
    args = dict(kv.split("=", 1) for kv in a.arg)
    ns = runpy.run_path(os.path.abspath(a.part))
    if "build" not in ns:
        sys.exit("part script must define build(args)")
    part = ns["build"](args)
    part = getattr(part, "part", part)  # accept a BuildPart context too
    os.makedirs(a.out, exist_ok=True)
    name = a.name or os.path.splitext(os.path.basename(a.part))[0]
    files = []
    for f in [x.strip().lower() for x in a.formats.split(",") if x.strip()]:
        path = os.path.join(a.out, f"{name}.{f}")
        if f == "step": bd.export_step(part, path)
        elif f == "stl": bd.export_stl(part, path)
        elif f == "glb": bd.export_gltf(part, path, binary=True)
        elif f == "obj": bd.export_obj(part, path)
        else: sys.exit(f"unknown format {f}; use step, stl, glb, obj")
        files.append({"file": path, "kb": round(os.path.getsize(path) / 1024, 1)})
    bb = part.bounding_box()
    print(json.dumps({
        "ok": True, "name": name, "units": "mm",
        "bbox_mm": [round(v, 2) for v in bb.size], "min_mm": [round(v, 2) for v in bb.min],
        "volume_mm3": round(part.volume, 1), "solids": len(part.solids()), "faces": len(part.faces()),
        "valid": bool(part.is_valid), "files": files,
    }))


if __name__ == "__main__":
    main()
