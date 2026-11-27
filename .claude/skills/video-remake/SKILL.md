---
name: video-remake
description: Remake a reference video, or change one thing in it, by rendering, comparing frame by frame and iterating until it matches. Rebuilds 3D web scenes (three.js) with the same camera path, layout and UI, renders deterministic frames headless, composes the final MP4 with ffmpeg, and scores each pass against the reference. Also edits the original directly when only one thing should differ, e.g. recolouring the water. Use when the user uploads a video and says "make a video like this", "loop until it's the same", "only change X", "recreate this animation", or wants a refined or extended version of a clip (more detail, characters added, new colours), or says "keep polishing until it's refined".
---

# Video Remake

Two routes. Pick by what the user wants to be different:

| User wants | Route | Result |
|---|---|---|
| "Same video, only X changed" (a colour, a logo, the text) | **Edit the original** (`scripts/recolor.py`, ffmpeg) | Every pixel except X is identical. A rebuilt version can never be pixel-identical, so say that and edit instead. |
| "Make one like this", "loop until it matches", "make mine better / add people" | **Rebuild and iterate** (three.js scene, then render, compare and fix) | A new video you own and can extend: more detail, characters, new colours, real 60 fps. |

The two routes can run together: deliver the edited original immediately while the rebuild renders.

Started from the SuperOS dashboard? Its `video-remake` planner (a read-only T2 skill in the vault) writes `reports/<day>_video-remake.md` with the route, the plan and the commands. Read that brief first and follow it unless Jay says otherwise.

## 1. Study the reference
```
bash scripts/analyze_reference.sh REF.mov work/ref top:0:96:1280:720 bottom:0:912:1280:720
```
This writes the probe (size, fps, duration, audio level), `contact.png` at 1 fps, full stills, and timestamped 0.25 s sheets per panel. **Read the images.** Note the layout (stacked panels, label bars), the UI chrome, the palette and the camera move per quarter-second. Write the camera keyframes from the dense sheets, which use exact seeks. The fps-filter contact sheet can be about 0.25 s off.

## 2a. Edit route: change one thing in the original
```
python3 -I scripts/recolor.py preview work/ref/full_8.51.png work/prev --pale --deep 188 236   # read side_by_side.png
python3 -I scripts/recolor.py video REF.mov out/green.mp4 --pale --deep 188 236
```
The mask is hue band AND saturation AND brightness, so a dim background of the same hue is kept. Preview a wide shot and a close-up for each panel, tune `--hue/--sat/--val/--pale/--deep/--to`, then run the full video. The audio is copied unchanged. To swap in a different colour, only `--hue` (source) and `--to` (target) change.

## 2b. Rebuild route: copy the example and adapt it
`assets/example-ship-in-bottle/` is a complete, working remake of a two-panel orbiting voxel scene. Its README explains the layout. Copy it to the project and keep its structure:
- `src/scene.js`: procedural models (an instanced-box voxel builder with hidden-face culling), materials, lighting, and `PATHS` camera keyframes `[t, azimuth°, elevation°, distanceScale]` with Catmull-Rom interpolation. Everything animates from `renderAt(t)`: no clock and no randomness, so frames are deterministic.
- `index.html?style=A|B`: one page per panel, with the UI overlay in HTML/CSS. Fonts come from `@fontsource/*` via npm, because Google Fonts may be blocked.
- `render.mjs`: a static server plus one headless Chromium per panel. It screenshots each frame, resumes if frames already exist, then composes label bars and panels and adds an ambient audio track. `--stills 0.5,5.5 --out DIR` renders check frames only.

Install with `npm install` (three, fonts). Playwright is global: load it with `createRequire(import.meta.url)('playwright')`, because a bare ES `import` fails.

## 3. Loop: render, compare, fix
```
node render.mjs --stills 0.5,5.5,13.5 --out work/itN
bash scripts/compare_videos.sh REF.mov work/full/ship.mp4 work/cmp top:0:96:1280:720 bottom:0:912:1280:720
```
Each pass:
1. Render 3 to 9 stills that cover the wide, orbit and zoom shots.
2. Look at the side-by-side images.
3. List the biggest gaps: scale, camera pose, colour, missing parts.
4. Fix those and repeat.

Fix camera and framing first, because those drive the score. Detail comes later. Expect blurred SSIM around 0.7 to 0.8 on matching wide shots and 0.3 to 0.5 on close-ups. Fine texture never matches a different model. Stop when every one-second pair matches in pose and framing, then render the full video and run `compare_videos.sh` on it.

## 4. Refine past the original (when asked)
Add life in the same deterministic `renderAt(t)` style. The example has all of these:
- crew: voxel people with arm pivots that wave, haul, walk and steer;
- cannons, lanterns and a rotating lighthouse beam;
- fish and bubbles, chimney smoke, and hull foam.

Re-check the close-ups, where people and details show. Render at native fps for the final video.

## 5. Polish loop: when the user says "keep going until it's refined"
Matching is done; now raise the quality. Each pass takes about 30 s:
```
TIMES=0.5,2.5,5.5,13.5 bash scripts/polish_stills.sh PROJECT work/polish/p1 top:0:96:1280:720 bottom:0:912:1280:720
```
Pick four moments from your camera path (wide, orbit, zoom, close-up) and read each panel's 2x2 sheet.
- **Critique in this order**, writing the list down before changing code:
  1. Anything wrong in physical terms: things floating, offset or clipping.
  2. Visual noise and clutter.
  3. Flat shading.
  4. Washed-out colour.
  5. Hard shadows.
  6. Crude edges.
  7. Animation collisions.
  8. Audio.
- **Zoom in to diagnose.** Crop the full still at 3× with nearest-neighbour scaling. A "glyph" on the water turned out to be whitecaps; a dotted line turned out to be misplaced foam.
- **Stop** when a pass finds nothing worse than minor.

Techniques that worked on the example, all in `src/scene.js`:
- **Cloth shading without geometry:** tint each sail voxel by belly (`1-u²`) and height, darken the bolt-rope edge, and add faint seams every few rows.
- **Diagonal edges:** build triangular parts (jibs, spankers) on a half-size voxel grid in their own mesh. The main grid stays the same.
- **Clutter to coherent:**
  - Drive placement with low-frequency noise patches (`vnoise(i*0.1, …) > t`), not per-voxel random hashes.
  - Pick each patch's palette per 9×9 cell.
  - Keep sand, moss and rock separate.
- **Clouds:** use a union of 3 ellipsoid puffs with a flat base and a lit top over a cool underside, not flat slabs.
- **Water:**
  - Colour the surface by its own wave height (vertex colours): trough to body colour, crest to a lighter tint, peak to foam.
  - Cut its environment reflections (`envMapIntensity` about 0.3), or it washes out to mint.
  - Keep foam on voxel water sparse, re-randomised each half second, and only a tint, never pure white.
- **Things on the water:** export one `waveHeight(style, x, z, t, amp)` and use it for both the surface and anything floating on it.
- **World-space attachments:** compute world positions from the parents' positions. A child placed by hand drifted 1.25 units off the hull.
- **Soft shadows:** use `PCFShadowMap` with `shadow.radius`, and move the sun closer to overhead so shadows sit under the object, not off to one side.
- **Characters:** make eyes by recolouring two face voxels (nothing sticks out). Give each walker its own lane so it never passes through standing crew.
- **Audio:** layer synthesized sound: stereo pink-noise wave beds with different swell periods, a quiet pad and gull chirps (`aevalsrc` decaying-frequency sine). Match the reference's mean level with `volumedetect` (about -30 dB) and check `showspectrumpic` that the layers are there (`render.mjs` `makeAmbience`).
- **Measure before paying for quality.** 1.5× supersampling (`?ss=1.5`) doubled the render time and only sharpened rigging lines, so the example stays at 1×. Crop-compare before committing hours of rendering.

## Hard-won lessons (read before building)
- **Transparent glass over a transparent canvas composites dark or wrong.** Draw the page background inside WebGL (`scene.background` = a gradient CanvasTexture) and make the canvas opaque.
- **No EffectComposer/bloom with large transparent glass.** Tone mapping then happens after blending, so bright reflections stack into a milky haze. Render directly. Self-lit lamps (MeshBasic) already read as glowing.
- A custom ShaderMaterial skips colour-space conversion. Output linear values (`pow(c, 2.2)`) if any linear pipeline is involved.
- With `set -e`, a `grep -v` that filters every line returns 1 and silently aborts the script. Add `|| true`.
- **Software WebGL (SwiftShader) runs about 3.5 to 5.5 s per frame at 1280×720, more as the scene grows.** A full 17 s, 60 fps render of the example takes about 1.5 hours. Give each panel its own browser so they render in parallel, make the render resumable, and wrap it in a retry loop because the browser can die mid-run. Run it in the background with `run_in_background` and wait for the notification. Do not poll with sleep.
- Never let two render processes write the same output. Kill the old one first, or the MP4 comes out corrupt. Verify it with `ffmpeg -v error -i out.mp4 -f null -`.
- Clip water to the bottle or container with a clipping plane plus an inset lathe of the container profile. Float the hull so waves don't swallow it, and keep masts and towers under the glass at every camera pose.
- Zoom shots: move the look-at target toward the subject as the distance shrinks, or the zooms frame empty water.

## Honesty rules
- Don't copy labels that credit other people or models with your output, such as "ChatGPT-6.2 Astra 5.49$". Use neutral labels (`--labelA/--subA`) and tell the user why.
- Report the real similarity scores and what still differs. Don't call a rebuild "the same" or "identical".
- Keep big MP4s out of git. Send them to the user and commit the code.
