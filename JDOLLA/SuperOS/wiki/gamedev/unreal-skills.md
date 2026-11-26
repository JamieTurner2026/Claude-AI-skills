---
title: Unreal Engine skills from outside repos
dept: gamedev
type: concept
sources:
  - raw/gamedev/unreal-skills/README.md
  - raw/gamedev/unreal-skills/awesome-gamedev-agent-skills/2026-11-26_repo-snapshot.md
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

### awesome-gamedev-agent-skills (Apache-2.0, 76 skills + router)
Source: [[raw/gamedev/unreal-skills/awesome-gamedev-agent-skills/2026-11-26_repo-snapshot]]

Text skills written from the engine docs. The 6 Unreal skills target **UE 5.8**; MIDNIGHT REIGN asks for 5.6 or newer, so check each API against the version in the project's `.uproject`. Jay chose the 6 Unreal skills plus the engine-neutral ones that fit a racing game (2026-11-26).

| Skill | On? | What it gives the build | Tested on PC |
|---|---|---|---|
| `unreal-cpp-gameplay` | On | UCLASS/UPROPERTY, GameMode, Pawn, PlayerController, Build.cs: the C++ side of the project | No |
| `unreal-blueprints` | On | Blueprint classes, event graphs, how Blueprints talk to each other | No |
| `unreal-enhanced-input` | On | Throttle, brake, steer and handbrake as Input Actions and Mapping Contexts, keyboard and gamepad | No |
| `unreal-behavior-trees` | On | Opponent driver AI with Behavior Trees, Blackboards and AIController (Milestone 2) | No |
| `unreal-niagara` | On | Tyre smoke, sparks, rain and exhaust effects | No |
| `unreal-packaging` | On | Development and Shipping builds, cooking, BuildCookRun from the command line | No |
| `game-ai` | On | State machines, steering and pathfinding for racing lines and opponents | No |
| `ai-behavior-trees-utility-ai` | On | Utility scoring for overtake, defend or recover decisions | No |
| `physics-tuning` | On | Fixed timestep, jitter, tunnelling (CCD) at high speed, alongside Chaos Vehicles | No |
| `camera-systems` | On | Chase camera follow, smoothing and collision | No |
| `game-feel` | On | Screen shake, impacts, speed feedback | No |
| `input-systems` | On | Rebinding, gamepad deadzones, accessibility | No |
| `performance-optimization` | On | Frame budget, profiling, draw calls, pooling | No |
| `level-design` | On | Blockout to playable track, pacing, critical path | No |
| `game-ui-ux` | On | HUD (speed, lap, position), menus, results screen | No |
| `save-systems` | On | Garage, credits and progress saves with versioning (the server decides rewards) | No |
| `audio-design` | On | Engine sound layers, music, ducking | No |
| `steam-publish` | On | Steamworks depots and steamcmd uploads, when the game ships | No |

Filed, off (in `raw/gamedev/unreal-skills/awesome-gamedev-agent-skills/`): the router, Godot (16), Unity (8), Ebitengine, web engines (Phaser, PixiJS, three.js), other engines (Bevy, Defold, LÖVE, pygame, Roblox), genres (no racing genre), the other disciplines (create-game-assets, dialogue, procedural generation, shaders), and the game-jam, itch and prototype-fast workflows.

Turn one on later: in the Claude-AI-skills repo, `cp -r JDOLLA/SuperOS/raw/gamedev/unreal-skills/awesome-gamedev-agent-skills/skills/<group>/<name> .claude/skills/`, then `./install.sh` on the PC.

## Related
- Department: [[depts/gamedev]] · Charter: [[wiki/gamedev/charter]] · Project: [[wiki/gamedev/midnight-reign]]
