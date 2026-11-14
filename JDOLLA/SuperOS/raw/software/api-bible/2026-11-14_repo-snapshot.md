# API Bible: repo snapshot (source)

Source: `JamieTurner2026/API-bible` (public), commit `cdd6b7c` dated 2026-11-03, read on 2026-11-14 from a shallow clone.
Read: `README.md`, `package.json`, full file listing (14 tracked files).
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- README describes a self-hosted REST API serving every book, chapter and verse of the Bible in three public-domain translations: BSB (default), WEB and ASV.
- All text lives in the repo under `data/`; no external services, no API keys, no dependencies beyond Node.js (engine 22.x).
- Endpoints include `/translations`, `/books`, `/books/:book/chapters/:chapter`, `/passage?ref=`, `/compare?ref=`, `/search?q=` and `/random`.
- Set up for Vercel: `api/index.js` runs the API as a serverless function. Tests run with `node --test`.
