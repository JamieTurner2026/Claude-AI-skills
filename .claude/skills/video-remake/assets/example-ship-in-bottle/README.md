# Ship in a Bottle — two-panel orbit video

Recreates a stacked comparison video of two voxel "ship in a bottle" WebGL scenes
(1280×1632, 60 fps, ~17 s): **Lantern Strait** on top, **The Bottled Sea** below, each
orbiting and zooming on a scripted camera path, with a label bar above each panel.

- `src/scene.js` builds both scenes procedurally with three.js. That includes the voxel ship, lighthouse,
  islands, reef, water, glass bottle, cork and stand. It also holds the keyframed camera paths (`PATHS`).
- `index.html?style=A|B` is the page for each panel, including its UI overlay.
- `render.mjs` renders frames deterministically in headless Chromium, adds an ambient sea track and
  composes the final MP4 with ffmpeg.
- Compare against the reference with the skill's `scripts/compare_videos.sh` (side by side plus per-panel SSIM).

```bash
npm install
node render.mjs --stills 0.5,5.5,13.5 --out out/stills      # quick check frames
bash ../../scripts/compare_videos.sh reference.mov out/video/ship-in-bottle.mp4 out/cmp   # side-by-side + SSIM
node render.mjs --fps 60 --out out/video                     # full video -> out/video/ship-in-bottle.mp4
node render.mjs --labelA "My title" --subA "subtitle" ...    # custom label bars
```

Needs Node 18+, ffmpeg and Playwright with Chromium. WebGL runs on SwiftShader, so no GPU is needed.
