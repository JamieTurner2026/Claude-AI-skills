# MIDNIGHT REIGN: repo snapshot (source)

Source: `JamieTurner2026/Midnight-regin` (public), commit `3f60f4e` dated 2026-11-13, read on 2026-11-14 from a shallow clone.
Read: `README.md`, `docs/roadmap.md`, top-level file listing (83 tracked files).
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- README describes it as an original open-world street racing game: Unreal Engine 5 (C++ and Blueprints, Chaos Vehicles), Blender for assets, with the original Pygame prototype kept as the gameplay reference.
- Layout: `prototype/python/` (original prototype and a tested port), `core/` (header-only C++17 gameplay maths, unit tested, no Unreal dependency), `blender/` (scripts that generate the car, parts and track), `assets/export/` (generated FBX), `unreal/MidnightReign/` (Unreal project), `docs/`.
- README status is Milestone 1, driving prototype. The Unreal project and the import script `unreal/MidnightReign/Scripts/setup_visuals.py` are marked written but not yet compiled or run; they need Unreal Editor on Jay's machine.
- README asks for Unreal Engine 5.6 or newer with C++ build tools (Visual Studio 2022 on Windows).
- Roadmap milestones: 1 Driving prototype, 2 Racing prototype (checkpoints, lap timing, basic opponent AI, results screen), 3 REIGN SCAN prototype, 4 Vehicle mastery, 5 Real scanning, 6 Expansion.
- Roadmap design rules: scanning only discovers a car and it is bought with earned credits; credits, XP, ownership and race rewards are decided on the server, never trusted from the client.
