#!/usr/bin/env bash
# Make Blender available. Prefers a system `blender`; otherwise installs the `bpy` module (headless Blender as a Python package).
set -e
if command -v blender >/dev/null 2>&1; then
  echo "mode=binary"; blender --version | head -1; exit 0
fi
if python3 -c "import bpy" >/dev/null 2>&1; then
  echo "mode=bpy"; python3 -c "import bpy;print('Blender', bpy.app.version_string)"; exit 0
fi
echo "Installing bpy (large download, a few minutes)..." >&2
python3 -m pip install --quiet bpy >&2 || { echo "FAILED: could not pip install bpy (needs network + a supported Python; bpy 5.x wants 3.11 or 3.13). Try: python3.11 -m venv .venv && .venv/bin/pip install bpy" >&2; exit 1; }
echo "mode=bpy"; python3 -c "import bpy;print('Blender', bpy.app.version_string)"
