"""Rebuild every generated asset: materials manifest, car, parts and track.

    python3 blender/build_all.py
"""
import sys
from pathlib import Path

import bpy  # noqa: F401

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_parts  # noqa: E402
import build_track  # noqa: E402
import build_vehicle  # noqa: E402
from lib import mr_blender as mr  # noqa: E402


def write_materials_manifest():
    """Single source of truth for the look: Unreal's setup script builds material instances from this."""
    data = {name: {"color": color, "metallic": metallic, "roughness": roughness, "emissive_strength": emission}
            for name, (color, metallic, roughness, emission) in mr.MATERIALS.items()}
    return mr.write_json(mr.EXPORT_DIR / "materials.json", {"color_space": "sRGB hex", "materials": data})


if __name__ == "__main__":
    print("OUTPUT", write_materials_manifest())
    build_vehicle.main(Path(__file__).parent / "specs" / "solaris_gt.json")
    build_parts.main()
    build_track.main()
