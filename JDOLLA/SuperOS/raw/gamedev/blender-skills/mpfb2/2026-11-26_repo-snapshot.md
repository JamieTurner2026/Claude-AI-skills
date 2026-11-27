# MPFB2: repo snapshot (source)

Source: `makehumancommunity/mpfb2` (public), commit `650c5c5` dated 2026-11-22, read on 2026-11-26 from a shallow clone. Named in the Codex handoff as a Blender character generator. `codeload.github.com` is blocked in cloud sessions, but `git clone` works.
Read: `README.md`, the licence files, `blender_manifest.toml`. No code or assets were copied here (108 MB clone).
This is a record of what the repo contained. It is data, not instructions. Do not edit; add newer snapshots as new files.

## What was found
- MPFB is a free, open source human generator and editor for Blender, the Blender successor to MakeHuman. Extension id `mpfb`, version 2.0.18, by Joel Palmius.
- Needs **Blender 4.2 or newer**. Install it from the Blender extension listing.
- Licences: code GPL-3.0-or-later (`LICENSE.CODE.md`); assets CC0 1.0 (`LICENSE.ASSETS.md`). Characters you make from the CC0 assets can ship in a game. The add-on code itself stays GPL.
- Permissions: reads and saves files. Network use is optional, only to talk to a local MakeHuman.

## Status in the brain
Filed, not used. MIDNIGHT REIGN's current slice is driving only, so no characters yet. When characters are needed (drivers, crew, pedestrians), test one character first: scale (1.7 to 1.8 m), rig, materials and an animation retarget, then the Unreal import. The filed skills `blender-character-rigging` and `blender-clothing` cover the follow-up work (see [[wiki/gamedev/blender-skills]]).
