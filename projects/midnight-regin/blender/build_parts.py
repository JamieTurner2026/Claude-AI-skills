"""Build the standalone customization parts as Unreal static meshes.

    python3 blender/build_parts.py

Each part's origin is its attach point (see lib/mr_parts.py), so in Unreal a
part is attached at the matching socket from the vehicle manifest with a zero
offset. Output: assets/export/parts/SM_*.fbx + assets/export/parts.json.
"""
import sys
from pathlib import Path

import bpy  # noqa: F401

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import mr_blender as mr  # noqa: E402
from lib import mr_parts  # noqa: E402

# name -> (category, socket on the vehicle, builder)
PARTS = {
    "SM_Wheel_FiveSpoke": ("wheel", "wheel bones", lambda n: mr_parts.build_wheel(n, 36, 24, 1, "five_spoke")),
    "SM_Wheel_Turbine": ("wheel", "wheel bones", lambda n: mr_parts.build_wheel(n, 36, 24, 1, "turbine")),
    "SM_Spoiler_Lip": ("spoiler", "spoiler", lambda n: mr_parts.build_spoiler(n, "lip", 140)),
    "SM_Spoiler_Wing": ("spoiler", "spoiler", lambda n: mr_parts.build_spoiler(n, "wing", 150)),
    "SM_FrontBumper_Splitter": ("front_bumper", "front_bumper", lambda n: mr_parts.build_front_splitter(n)),
    "SM_RearBumper_Diffuser": ("rear_bumper", "rear_bumper", lambda n: mr_parts.build_rear_diffuser(n)),
}


def main():
    out_dir = mr.EXPORT_DIR / "parts"
    listing = []
    for name, (category, socket, builder) in PARTS.items():
        mr.reset_scene()
        obj = builder(name)
        mr.export_fbx(out_dir / f"{name}.fbx", [obj])
        lo, hi = mr.world_bounds([obj])
        listing.append({
            "name": name, "fbx": f"parts/{name}.fbx", "category": category, "attach_socket": socket,
            "size_cm": [round(hi[i] - lo[i], 1) for i in range(3)], "triangles": mr.tri_count(obj),
            "materials": [m.name for m in obj.data.materials],
        })
        print(f"OUTPUT {out_dir / (name + '.fbx')}  ({listing[-1]['triangles']} tris)")
    mr.write_json(mr.EXPORT_DIR / "parts.json", {"units": "cm", "parts": listing})


if __name__ == "__main__":
    main()
