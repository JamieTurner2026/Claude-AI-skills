# awesome-gamedev-agent-skills: repo snapshot (source)

Source: `gamedev-agent-skills-main.zip` uploaded by Jay on 2026-11-26. Upstream is `gamedev-skills/awesome-gamedev-agent-skills`. Apache-2.0, © 2026 Abhishek Barali and contributors (`LICENSE`, `NOTICE`). NOTICE says every skill was written from primary engine docs, with no text copied from other skill collections.
Read: `README.md`, `NOTICE`, `docs/VERSION-SUPPORT.md`, the router, the Unreal README and every Unreal `SKILL.md`, and the descriptions of the chosen engine-neutral skills.
Copied here unchanged: `skills/`, `router/`, `scripts/`, `tests/`, `docs/*.md`, plus licence, notice, README and CONTRIBUTING. The plugin manifest and CI workflows are in `upload/`. Images were left out.
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- 76 skills plus a router, in the standard `SKILL.md` format. The router detects the engine from project files (`*.uproject` means Unreal) and loads the matching skills.
- Groups:
  - unreal (6): behavior-trees, blueprints, cpp-gameplay, enhanced-input, niagara, packaging. They target **UE 5.8**; MIDNIGHT REIGN asks for 5.6 or newer, so check APIs against the project's `.uproject` version.
  - disciplines (16)
  - godot (16)
  - unity (8)
  - ebitengine (1)
  - web-engines (6)
  - other-engines (11: Bevy, Defold, LÖVE, pygame, 7 Roblox)
  - genres (9, no racing genre)
  - workflows (4)
- Most skills are text only. Scripts are project checkers (Godot, Unity, Defold, Ebitengine, Steam build) and asset tools.
- Code scan on 2026-11-26: URLs appear only in the site generator, the link checker and test fixtures. `subprocess` is used only in tests and the macOS app packager (`lipo`). No skill script contacts the network.
- The repo's validator and tests were not run in the cloud session: running downloaded code was blocked by the session's safety check.
