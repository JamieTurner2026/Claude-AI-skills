# Blender Agent Skills: repo snapshot (source)

Source: `EL4CTEO/blender-skills` (public), commit `1a1cc6c` dated 2026-11-21, read on 2026-11-24 from a shallow clone. Jay uploaded its `plugin.json`, `marketplace.json`, `ci.yml`, `.gitattributes`, `.gitignore` and preview images (kept in `upload/`). Version 1.3.3, MIT licence (c) 2026 EL4CTEO.
Read: `README.md`, `AGENTS.md`, every `SKILL.md` description, `blender-core` and `blender-workflow-recipes` in full, `run_in_blender.py`, the test runner. Copied here unchanged: `skills/`, `shared/`, `tests/`, `tools/`, licence and docs; `docs/` (5.7 MB of comparison images) and `assets/` were left out.
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- 28 skills in the standard `SKILL.md` format for Blender 5.2 LTS+, verified on 5.3. `blender-core` is the entry point: it routes to the others and sets the 5.x API rules. `blender-asset-qa` is the required review gate after any geometry work.
- Scripts in `skills/*/scripts/` each expose `run(**kw) -> dict`, document their flags in the docstring and print one JSON result. Headless: `python blender-core/scripts/run_in_blender.py [--blend F] SCRIPT.py -- args` (finds `blender` via `BLENDER_EXE`, PATH or standard install folders). Live: through the MCP for Blender `execute_blender_code` tool, importing the script and calling `run()`.
- Each skill carries its own copy of the shared helper `_bpyx.py` (synced from `shared/` by `tools/sync_shared.py`).
- Tests: 67 headless Blender tests (`tests/run_all.py`, run inside Blender), CI on Blender 5.2.3 and 5.3.0 with GPU render tests skipped (`BAS_SKIP_GPU=1`).
- Code scan on 2026-11-24: no network calls in skills, shared, tools or install scripts; the only `subprocess` use starts Blender (`run_in_blender.py`, `tools/run_tests.py`).
- Skills: core, scene-setup, hardsurface-modeling, sculpting, retopology-uv, pbr-materials, texturing, texture-baking, geometry-nodes, character-rigging, facial-shapekeys, animation, clothing, hair-grooming, game-optimization, export-pipelines (Roblox, Unity, Unreal, Godot, web, USD), rendering, lighting-lookdev, stylized-npr, environment-kits, video-editing, simulation, time-of-day, weather-fx, addon-development, pipeline-automation, asset-qa, workflow-recipes.
