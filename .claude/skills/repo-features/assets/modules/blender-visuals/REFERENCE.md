---
name: blender-visuals
description: Create images, animations and 3D models with Blender, driven headlessly from Python. Use when the user wants a 3D render, turntable or animation video, title card, a 3D diagram of a machine/station/component layout, or to build/convert a model (glTF, OBJ, STL, .blend) - or wants any visual that Blender can produce for training material, documentation or a repo.
---

# Blender Visuals

Claude writes a small Python scene script; `scripts/render.py` runs it in headless Blender and writes PNG / MP4 / model files. You then **look at the result** (Read the PNG) and iterate.

## Setup (once per session)
```
bash scripts/setup_blender.sh      # uses `blender` if installed, else `pip install bpy` (big download, a few minutes)
```
It prints `mode=binary` or `mode=bpy`. bpy 5.x needs Python 3.11 or 3.13; if pip can't install it, tell the user rather than faking output. If the install worked into a venv, run `render.py` with that venv's python.

## Render
```
python3 scripts/render.py SCENE.py --out OUT_DIR [--width 1280 --height 720 --samples 32]
        [--frames N --fps 24 --mp4] [--export part.glb|.obj|.stl|.blend] [--arg key=value ...]
```
Outputs are listed as `OUTPUT <path>`. CPU Cycles is the default (works headless); `--engine eevee` needs OpenGL and often fails on servers. Samples are capped at 256.

## Starter scenes (`assets/scenes/`)
| goal | scene | key args |
|---|---|---|
| title card / label | `title_card.py` | `title=`, `subtitle=`, `bg=`, `color=` |
| rotating object video | `turntable.py` with `--frames 48 --mp4` | `shape=monkey\|cube\|sphere\|torus\|cone` or `model=file.glb/.obj/.stl`, `color=` |
| machine / station diagram | `machine_diagram.py` | `spec=spec.json` (nodes with id/label/kind/pos/size/color, links); see `assets/examples/servo_station.json` |
| build + export a model | `model_export.py --export part.stl` | `shape=`, `size=` |

For a machine diagram from `video-knowledge` entries: one node per component, links following the signal/flow order the instructor described; keep labels short.

## Writing a custom scene
A scene file defines `build(args)` and optionally `animate(frame, total, args)`. Import helpers with `from lib.bl_helpers import *`: `material`, `assign`, `set_background`, `add_lights`, `add_primitive`, `add_text`, `import_model`, `link_between`, `add_camera_fit` (frames everything, call it **last**), `bounds`. Animate by setting object transforms in `animate()` per frame (no keyframes needed).

## Workflow
1. Preview first: `--width 640 --height 360 --samples 8-16`. 2. Read the PNG and check framing, readability, colours. 3. Fix and repeat. 4. Final render at the requested size/samples. 5. Give the user the file path(s) in an allowed output folder.
Never claim a visual is done without having viewed it (for video, view 2-3 frames from `OUT/frames/`).

## Pitfalls
- Always call `add_camera_fit` after creating everything (text bounds are measured after a scene update, already handled).
- bpy 5.x removed `action.fcurves`; don't edit keyframe interpolation, drive motion in `animate()`.
- Text is the built-in font; keep it short. Labels should face the camera (rotate X by 90° for a front-facing view).
- Don't import untrusted `.blend`/scripts: scene scripts run arbitrary Python.
- Render time scales with pixels × samples; 1280x720 at 32 samples takes seconds for simple scenes, minutes for complex ones.
- No GPU here; CPU only.
