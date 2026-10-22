---
name: repo-features
description: Add drop-in feature modules to a repository - video-knowledge (training videos to searchable knowledge base), blender-visuals (headless Blender renders and diagrams), ai-chat (server-side Claude chat endpoint for Next.js). Use when the user wants one of these capabilities in a project, or asks what reusable features are available.
---

# Repo Features

```
python3 scripts/add_feature.py --list
python3 scripts/add_feature.py MODULE --dest REPO_DIR
```
| module | adds | needs |
|---|---|---|
| `video-knowledge` | `tools/video-knowledge/` (ingest videos, merge, search with timestamps) | ffmpeg, Pillow; `faster-whisper` for speech-to-text |
| `blender-visuals` | `tools/blender-visuals/` (stills, turntables, machine diagrams, model export) | `pip install bpy` (Python 3.11/3.13) |
| `ai-chat` | `app/api/chat/route.ts` (Next.js only) | `ANTHROPIC_API_KEY` server-side env var |

Not built yet: auth, file upload. Say so if asked rather than improvising a module; build it properly and add it under `assets/modules/` with a `MODULE.md`.

After adding, read the module's printed notes, add the module to the repo's `CLAUDE.md` "Knowledge and visuals" section if relevant, add any env var names to `.env.example`, and run the repo's lint/build. The script never overwrites existing files. `ai-chat` is only typechecked, not tested against the live API.
