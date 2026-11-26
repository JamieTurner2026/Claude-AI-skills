---
title: Blender skills from outside repos
dept: gamedev
type: concept
sources:
  - raw/gamedev/unreal-skills/codex-handoff/2026-11-26_handoff-snapshot.md
  - raw/gamedev/blender-skills/mpfb2/2026-11-26_repo-snapshot.md
  - raw/gamedev/blender-skills/build123d/2026-11-24_repo-snapshot.md
  - raw/gamedev/blender-skills/blender-agent-skills/2026-11-24_repo-snapshot.md
  - raw/gamedev/blender-skills/mcp-for-blender/2026-11-24_repo-snapshot.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/bpy.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/scene.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/materials.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/animation.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/rigging.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/retopology.md
  - raw/gamedev/blender-skills/mcp-for-blender/guides/level-design.md
updated: 2026-11-24
last_used: 2026-11-24
---
# Blender skills from outside repos

What each Blender skill repo Jay sends adds to the build, and whether it works now. "Works now" means it works with the headless `blender-visuals` skill (Python scene script, `render.py`, read the PNG), with no Blender window open. Source folder: `raw/gamedev/blender-skills/`.

## MCP for Blender (v2.3.1, MIT)
Source: [[raw/gamedev/blender-skills/mcp-for-blender/2026-11-24_repo-snapshot]]

| Piece | Works now? | What it gives the build |
|---|---|---|
| `bpy` guide | Yes | Scripts that survive Blender versions: find nodes by type, renamed Principled BSDF inputs (`Emission Color` in 4.0+), EEVEE named `BLENDER_EEVEE_NEXT` in 4.2 to 4.x, fcurves moved in 4.4/5.0. It showed two bugs in our helpers, now fixed. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/bpy]] |
| `materials` guide | Yes | Real-looking values for painted metal, plastic, rubber and glass on machine and station renders. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/materials]] |
| `scene` guide | Yes | Block out at real size first, focal lengths (35 to 50 mm natural, 85 mm+ product), three-point light. For training visuals and title cards. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/scene]] |
| `animation` guide | Yes | Keyframes that work in every version; linear motion for conveyors and servos; loop seams. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/animation]] |
| `retopology` guide | Yes | Clean and lighten meshes; triangle budgets (prop 500 to 5k, hero character 15 to 50k). For MIDNIGHT REIGN assets. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/retopology]] |
| `level-design` guide | Yes | Player metrics, grey-box blockout, modular kits, Unreal names (`SM_`, `UCX_` collision), FBX export. Fits MIDNIGHT REIGN (Unreal 5). Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/level-design]] |
| `rigging` guide | Partly | Mechanical rigs (parts parented to bones) fit robot and servo stations now; Rigify characters later. Source: [[raw/gamedev/blender-skills/mcp-for-blender/guides/rigging]] |
| MCP server and add-on | PC only, not set up | Claude drives a live Blender window: screenshots from any angle, scene info, asset libraries. Needs Blender open on Jay's PC. Steps: [[wiki/gamedev/blender-mcp-setup]] |
| AI model generators, World Labs worlds | No | Paid keys or paid Premium. Left out until Jay asks. |

Where it went: the seven guides are adapted for headless use in the `blender-visuals` skill (`references/`), with the MCP tool calls swapped for preview renders. The originals stay unchanged in `raw/`.

## Blender Agent Skills (v1.3.3, MIT, 28 skills)
Source: [[raw/gamedev/blender-skills/blender-agent-skills/2026-11-24_repo-snapshot]]

Ready-made, tested skills for Blender 5.2 LTS+ (verified on 5.3). They run without a Blender window and print JSON results; with the MCP above they also run in a live Blender. Start point: `blender-core`. Every geometry job ends with `blender-asset-qa`. Jay chose 19 to switch on and 9 to file for later (2026-11-24).

### On (in `.claude/skills/`)
| Skill | How it helps |
|---|---|
| `blender-core` | Runs Blender scripts, routes to the right skill, 5.x API rules |
| `blender-asset-qa` | Catches z-fighting, floating parts, bad normals and scale; multi-angle review sheets |
| `blender-scene-setup` | Real-world units, `SM_/T_/M_` naming, collections, clean files before handoff |
| `blender-hardsurface-modeling` | Car parts, props, machine parts: bevels, booleans, weighted normals |
| `blender-retopology-uv` | Light game meshes and clean UVs, texel density, lightmap UV2 |
| `blender-pbr-materials` | Correct metal/roughness materials, texture sets, DirectX normals for Unreal |
| `blender-texturing` | Edge wear, grime, dust, decals, trim sheets |
| `blender-texture-baking` | High-to-low normal, AO and curvature maps, ORM packing |
| `blender-game-optimization` | Triangle/material budgets per platform, LOD chains, draw calls |
| `blender-export-pipelines` | MIDNIGHT REIGN export to Unreal (FBX, UCX collision, Nanite); also Unity, Godot, web, Roblox |
| `blender-rendering` | Cycles/EEVEE settings, colour management, batch renders |
| `blender-lighting-lookdev` | Studio and product lighting, HDRI, cameras, turntables for training material |
| `blender-environment-kits` | Terrain, scatter, modular kits for tracks and city blocks |
| `blender-animation` | Actions, loops, mocap retargeting, root motion, clip export |
| `blender-time-of-day` | Night city glow, golden hour, fog: MIDNIGHT REIGN moods |
| `blender-weather-fx` | Rain, wet streets, puddles, lightning |
| `blender-pipeline-automation` | Batch convert and check folders of models |
| `blender-video-editing` | Cut renders into training videos, titles, music |
| `blender-workflow-recipes` | Full playbooks: game prop, environment, turntable, rainy night shot |

### Filed, off (in `raw/gamedev/blender-skills/blender-agent-skills/skills/`)
| Skill | When it would help |
|---|---|
| `blender-character-rigging` | Rigging drivers or characters (Rigify, game skeletons) |
| `blender-facial-shapekeys` | Face expressions and lip-sync |
| `blender-clothing` | Clothes on characters |
| `blender-hair-grooming` | Hair and fur |
| `blender-sculpting` | Organic shapes |
| `blender-stylized-npr` | Toon/anime looks and outlines |
| `blender-simulation` | Cloth, rigid bodies, fluids |
| `blender-geometry-nodes` | Procedural modeling from JSON |
| `blender-addon-development` | Writing Blender add-ons |

### Turn one on later
In the Claude-AI-skills repo: `cp -r JDOLLA/SuperOS/raw/gamedev/blender-skills/blender-agent-skills/skills/blender-<name> .claude/skills/`, then `./install.sh` on the PC. Also remove its "(filed, off*)" mark in `.claude/skills/blender-core/SKILL.md`.

### What it needs
- PC: Blender 5.2 LTS or newer (5.3 recommended) installed; the scripts find it.
- Cloud sessions: the Blender download is blocked, but `pip install bpy` (5.3) runs the scripts by importing them.
- Tested 2026-11-24 in the cloud with pip `bpy` 5.3.0: the repo's suite gave 73 passed, 1 failed, 5 skipped. The failure (add-on validate) needs the Blender program, not the Python module; the skips need a GPU. A crate run end to end (modifier stack, QA, LODs, Unreal FBX export) worked, and QA caught a planted floating part and z-fighting. `review_shots.py` contact sheets need a GPU, so on cloud sessions check visuals with a `blender-visuals` Cycles render instead.

## build123d (Apache-2.0): exact CAD parts
Source: [[raw/gamedev/blender-skills/build123d/2026-11-24_repo-snapshot]]

Not a Blender pack: a Python library that builds exact parts in millimetres (holes, slots, fillets) and exports STEP, STL and GLB. Jay chose to turn it into a skill (2026-11-24).

| Piece | Works now? | What it gives the build |
|---|---|---|
| `cad-parts` skill (new, in `.claude/skills/`) | Yes | Brackets, sensor mounts, plates and enclosures for servo stations and training rigs. STEP for CAD/CNC, STL for 3D printing, GLB that drops into `blender-visuals` machine diagrams at true size. Examples: servo bracket, M18 sensor mount. |
| Sheet metal (`BuildSheet`, `unfold`) | No | Only in the build123d dev branch, not the released 0.13.0. Bent brackets are modelled as solids for now. |

Needs: `bash .claude/skills/cad-parts/scripts/setup_cad.sh` once per machine (own venv, about 900 MB, Python 3.11 to 3.14). Tested 2026-11-24: both examples are valid single solids, their volumes match a hand estimate within 0.4%, and they rendered correctly in Blender 5.3.
Training and simulation only: a model here is never a certified drawing for real equipment.

## Blender → Unreal
From the Codex handoff (2026-11-26): its six Unreal skills were already in and switched on, unchanged. They are now the Blender skills' next step: `blender-core` routes there after export, and `blender-export-pipelines` points to them. Source: [[raw/gamedev/unreal-skills/codex-handoff/2026-11-26_handoff-snapshot]]

1. **Build and check in Blender:**
   - `/blender-core` and the modeling and material skills;
   - `/blender-asset-qa` for numbers and a review sheet;
   - a `blender-visuals` Cycles render to judge the look.
2. **Export:** `blender-export-pipelines` with `--preset unreal` (FBX, cm scale, `UCX_` collision, LODs from `blender-game-optimization`).
3. **Realism review after import** (the handoff's checklist): silhouette, scale against a 180 cm reference, materials, lighting, collision. Fix in Blender and re-export rather than patching in Unreal.
4. **In Unreal, in the handoff's priority order:**
   - `unreal-blueprints` for one clear interaction;
   - `unreal-enhanced-input` for controls;
   - `unreal-niagara` for effects that make player actions clear;
   - then `unreal-cpp-gameplay` and `unreal-behavior-trees` as needed;
   - `unreal-packaging` to test a standalone build.
5. **Characters:** MPFB2 (Blender 4.2+, code GPL-3.0, assets CC0) is filed for later. Test one character's scale, rig, materials and animation first. Source: [[raw/gamedev/blender-skills/mpfb2/2026-11-26_repo-snapshot]]

First test: the MIDNIGHT REIGN checkpoint run (see [[wiki/gamedev/midnight-reign]]). Tested on PC: not yet.

## Related
- Department: [[depts/gamedev]] · Charter: [[wiki/gamedev/charter]] · Project: [[wiki/gamedev/midnight-reign]]
- Also used by [[depts/industrial]] (machine diagrams) and [[depts/creative]] (renders)
