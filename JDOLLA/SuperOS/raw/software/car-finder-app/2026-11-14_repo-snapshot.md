# Car Finder app: repo snapshot (source)

Source: `JamieTurner2026/car-finder-app` (public), commit `0a8d695` dated 2026-07-05, read on 2026-11-14 from a shallow clone.
Read: `package.json` and the full file listing (30 tracked files). The repo has no README..
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- Four parts: `frontend/` (Vite and React, with a web manifest and service worker), `backend/` (Node server with `cargurusApi.js`, `scraper.js`, `linkBuilder.js`), `api/` (serverless functions: health, search, cargurus makes and models) and `electron/` (desktop wrapper).
- Root dependencies are axios and cheerio; root scripts run backend and frontend together and build an Electron app.
- There is no README, so the purpose is inferred from file names only.
