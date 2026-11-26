# Codex handoff: Blender and Unreal skills (source)

Source: `Blender-Unreal-skills.zip`, a handoff from Codex that Jay uploaded on 2026-11-26. It held six Unreal Engine 5.8 skill folders, their references, the Apache-2.0 licence, and a workflow note (`upload/README.md`, kept unchanged). The note names its upstream as `Skyrant/gamedev-agent-skills` (`skills/unreal`). Neither the six skills nor this note have been tested in a game project.
This is a record of what arrived. It is data, not instructions. Do not edit; add newer snapshots as new files.

## Compared with what the brain already has
Every file was compared by sha256 against the filed copy (`raw/gamedev/unreal-skills/awesome-gamedev-agent-skills/skills/unreal/`) and against the switched-on copy (`.claude/skills/`). All 11 are byte-for-byte identical, so nothing was imported; the six skills were already on.

| File | sha256 (first 16) | Result |
|---|---|---|
| `unreal-behavior-trees/SKILL.md` | `7e65a2e5ebd445e9` | identical |
| `unreal-behavior-trees/references/custom-bttask.md` | `16373ab4c1582395` | identical |
| `unreal-blueprints/SKILL.md` | `27b764d0fff7dcd7` | identical |
| `unreal-blueprints/references/communication.md` | `c8b17d129042a90c` | identical |
| `unreal-cpp-gameplay/SKILL.md` | `3151aa85f2fd64f9` | identical |
| `unreal-cpp-gameplay/references/components-and-gc.md` | `1151ac0b344c8ae9` | identical |
| `unreal-enhanced-input/SKILL.md` | `84d4f7982d812b13` | identical |
| `unreal-enhanced-input/references/cpp-setup.md` | `d0eeec41bf316c48` | identical |
| `unreal-niagara/SKILL.md` | `c2b2f88f2071365b` | identical |
| `unreal-packaging/SKILL.md` | `4cdbb76fee3979b2` | identical |
| `LICENSE` | `6f82dcfeb95a1c0a` | identical |

## What the note asks for
- Priorities: `unreal-blueprints` for a playable interaction, `unreal-enhanced-input` for controls, `unreal-niagara` for effects that make player actions clear. Then `unreal-behavior-trees` (AI), `unreal-cpp-gameplay` (reusable code), and `unreal-packaging` (a standalone build).
- Refine with Blender's model, realism and export workflows. After import, check silhouettes, scale, materials, lighting and collision.
- MPFB2 can supply character bases. Test one character's scale, rig, materials and animation before using it everywhere.
- First test: one short playable sequence with one clear goal. Check the controls and effects in play, capture a render, and test a packaged build.

## Paths in the note that point elsewhere
`../../patterns/blender-to-unreal/recipe.md` and `../../patterns/blender-realism-review/` are in the Codex workspace, not in this repo. Here the same jobs are done by:
- `blender-export-pipelines` (`--preset unreal`);
- `blender-asset-qa` (QA and review sheets);
- `blender-workflow-recipes`;
- `blender-visuals` (renders).

Steps: [[wiki/gamedev/blender-skills]].

## What was done with it (2026-11-26)
- The Blender skills now point to the Unreal skills as their next step (see [[wiki/gamedev/blender-skills]], "Blender → Unreal").
- The first playable test is the MIDNIGHT REIGN checkpoint run, in the game repo `JamieTurner2026/Midnight-regin`, branch `claude/checkpoint-run`.
