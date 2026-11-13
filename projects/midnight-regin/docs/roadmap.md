# Roadmap

One milestone at a time. A milestone is finished when it has been played in the editor.

| # | Milestone | Scope |
|---|---|---|
| 1 | Driving prototype | One drivable car: throttle, brake/reverse, steering, nitrous, chase camera, plus generated car, parts and test block. **Code and assets ready; needs compile, import script run and a drive.** |
| 2 | Racing prototype | Small Solaris Coast block, checkpoints, lap timing, basic opponent AI, results screen |
| 3 | REIGN SCAN prototype | Simulated scan, three-car catalog, discovery records, dealership purchase with credits, garage ownership |
| 4 | Vehicle mastery | Per-car XP (levels 1–50), upgrade tiers at 5/10/20/35/50, compatibility checks, purchase + visual install |
| 5 | Real scanning | Mobile camera capture → recognition service → server-verified discovery synced to the account |
| 6 | Expansion | Traffic, police pursuits, crews, more vehicles, multiplayer, Neo Kairo, Vice Harbor, Iron Borough, Mirage Dominion, platform optimisation |

## What can be done where

| Work | Claude Code (cloud) | Needs your machine |
|---|---|---|
| C++ gameplay classes, data structures, automation tests | Writes them | Compile and run in Unreal Editor |
| Engine-independent rules (race timing, economy, mastery, compatibility) | Writes **and tests** them in `core/` | — |
| Database schema, security rules, server functions (Supabase/Postgres) | Writes, and can test against a Supabase project you connect | — |
| Blueprints, UMG screens, maps, World Partition, materials, VFX, audio | Step-by-step instructions only | Unreal Editor |
| Vehicle and environment models, rigs, animations | Blender Python scripts for repeatable pipelines | Blender for modelling; review of results |
| Console builds (PlayStation, Xbox) | — | Platform holder developer accounts and SDKs |
| iOS / Android builds, camera access | Code and configuration | Xcode / Android Studio, devices, store accounts |
| Vehicle recognition | Server integration code | Choice of provider, API key (stored as a server secret) |

## Design rules carried through every milestone

- Scanning only *discovers* a car; it is bought with earned credits.
- Reaching a mastery level makes an upgrade *eligible*; it is still purchased, and the server checks
  compatibility, level, ownership and balance.
- Credits, XP, ownership, scan results and race rewards are decided on the server, never trusted
  from the client.
- Cars are prebuilt original or licensed assets matched to a scan. A photo does not generate a model.
- Cities and vehicle names are fictional.
