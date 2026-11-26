---
title: Unreal Engine skills from outside repos
dept: gamedev
type: concept
sources:
  - raw/gamedev/unreal-skills/README.md
updated: 2026-11-26
last_used: 2026-11-26
---
# Unreal Engine skills from outside repos

What each Unreal Engine skill repo Jay sends adds to the build, and whether it is switched on. Source folder: `raw/gamedev/unreal-skills/` (filing rules in its README).

## What counts as a fit
Judged against [[wiki/gamedev/midnight-reign]]: Unreal Engine 5.6 or newer, C++ and Blueprints, Chaos Vehicles.
- Editor Python and automation (import, setup, batch jobs)
- Bringing Blender assets in: FBX with `SM_` meshes, `UCX_` collision and LODs
- Vehicle physics and driving feel
- Gameplay systems: checkpoints, lap timing, opponent AI, results screen (Milestone 2)
- World building, lighting, performance and profiling
- Automated tests and build checks

## What runs where
Unreal Editor only runs on Jay's PC. Cloud sessions can read, file and check a skill (its format, and whether its scripts parse), but anything that needs Unreal is tested on the PC. Each skill below is marked "tested on PC: yes/no".

## Repos
None filed yet.

| Repo | Skill | On? | What it gives the build | Tested on PC |
|---|---|---|---|---|

## Related
- Department: [[depts/gamedev]] · Charter: [[wiki/gamedev/charter]] · Project: [[wiki/gamedev/midnight-reign]]
