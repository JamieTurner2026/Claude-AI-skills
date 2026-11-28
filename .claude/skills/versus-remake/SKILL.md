---
name: versus-remake
description: Rebuild a split-screen "two builds of the same game" comparison video (two browser games side by side with titles and build-time counters, e.g. "Model X: 9.21 minutes" vs "Model Y: 15.04 minutes") as an original three.js film rendered frame by frame, then score it against the reference and loop until it matches. Ships a complete worked example (ring-run: a space-flight HUD, a ring station, a planet, two fighters), a measured-data layout, a planet-limb fitter, numeric ship and camera pose fitting, per-panel SSIM scoring and a synthesized engine/whoosh score. Use when the user shares a side-by-side game or model-comparison clip and wants it broken down, its tech stack identified, or remade 1:1, or wants a new comparison film in that format.
---

# Versus remake

A comparison clip like this is three layers. Rebuild each one from measurements, not by eye:

| Layer | What it is in the reference | How the remake builds it |
|---|---|---|
| Frame | white 1876x1030 canvas, two 900x900 panels with 20 px rounded corners, a bold title and a green counter over each | `main.js` + `style.css` (HTML/CSS, Inter) |
| Game | a three.js WebGL scene per panel: chase-camera ship, target, backdrop | `world.js` (procedural models, shaders), `camera.js` (scripted path + fitted corrections) |
| HUD | DOM overlay: objective, compass tape, mission clock, speed, shield/energy bars, key hints, radar, reticle, target brackets, banners | `hud.js`, driven by `data.js` (every number measured from the reference) |

**Tech stack of such clips (what to tell the user):** each panel is a browser game written in a single HTML file with three.js (WebGL) and an HTML/CSS HUD (Inter for labels, a monospace face such as JetBrains Mono for numbers), screen-recorded while played, then the two recordings are placed side by side in a video editor with a title and an animated build-time counter. Tells: crisp DOM text over a 3D canvas, browser-style font rendering, a real-time mission clock, a counter that advances at a constant rate in **minutes.seconds** (0.47 → 1.16 is 47 s → 76 s, not a decimal).

The kit needs the `teardown` skill next to this one (it provides `sims/build.mjs`, `sims/capture.mjs`, `paths.mjs` and node_modules with three, esbuild, playwright and fonts). Set `TEARDOWN=/path/to/teardown` if it lives elsewhere.

## Honesty and IP rules (read first)

- **Labels:** do not reproduce titles that credit a named model or person with the remake ("Claude Opus 5.6: 28 minutes"): the remake was not made by them. Use neutral labels (`LABEL` in `main.js`: "Build A" / "Build B") with the same counters, and tell the user why.
- **Designs:** do not copy a franchise design that appears in a panel (a recognisable film starfighter, a game's mascot). Build an original model of similar size, placement and colour mass, and say it will score lower there.
- Report the real scores per panel. A rebuild of a cinematic or AI-rendered panel will not reach 0.99; say what still differs.

## 1. Study the reference

```bash
REF=ref.mp4; mkdir -p ref
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,nb_frames,sample_rate -of compact $REF
ffmpeg -i $REF -vf "fps=1,scale=480:-1,tile=4x4" -frames:v 1 ref/contact.png
for p in A:30:100 B:946:100; do IFS=: read n x y <<< "$p"; ffmpeg -i $REF -vf "fps=4,crop=900:900:$x:$y,scale=300:300,tile=8x5" -frames:v 1 ref/dense_$n.png; done
```

Then read the numbers, 0.25 s apart, by stacking crops into one image and reading it once:

- the counters (`crop=1876:40:0:55`), the speed / shield / energy readouts, the compass labels;
- the end sequence frame by frame (`-ss 7.5 ... 9.25`): alert, the pass through the target, the success banner.

Write them into `data.js` as tables. Find the formula behind each table (a linear counter, a clock running in real time, a distance that is the integral of speed) so every frame is right, not only the sampled ones.

Measure the panel rectangles and corner radius from pixels (`numpy`, first non-white pixel per row).

## 2. Build the panels

Copy `sims/ring-run/` and edit. Everything is a pure function of t (`window.SIM.render(t)`), so frames are deterministic.

- `world.js`: the backdrop (sky shader + planet shader + additive halo) is drawn first with the camera's rotation only, so a planet 1000 km away never fights the depth buffer of a station 2 km away. Stations are instanced boxes; ships are camera-attached groups.
- Scale objects from the reference's own readouts. A target bracket that grows as 1/distance, and a distance label, give metres per pixel: ring radius = pixels × distance / focal (focal = 450 / tan(fov/2)). The two planes of a station (ring vs core disc) must grow by the same ratio between two times; if they don't, you are measuring the wrong ring.
- Planet: `python3 -I scripts/fit_planet.py REF.mp4 T PANEL_X PANEL_Y` traces the limb at a frame where the camera looks straight ahead and solves the planet direction and angular radius (rms error is printed; under 0.2° is good). A cone of angle ρ about c equals one of 180°−ρ about −c: use the one under 90°, pointing at the planet.
- Shade the planet by view angle (dark teal facing the camera, brighter toward the limb, plus a rim), not by a sun lambert term: that is what an orbital shot looks like.

## 3. Fit poses numerically

```bash
node scripts/fit.mjs ship   SIM_DIR REF.mp4 A --times 0.5,3,9.5,9.9 --sym   # ship pose: paste into STYLES.A.ship
node scripts/fit.mjs camera SIM_DIR REF.mp4 A --times $(python3 -c "print(','.join(str(i*0.25) for i in range(41)))")
```

- Renders only the panel's 3D layer at 300 px, compares it with the reference panel (grey, blurred, HUD boxes masked) and runs Nelder-Mead. About 10 s per sample on software WebGL.
- Fit the ship first (it is in every frame), with `--sym`: without it the fit turns the ship to hide a model mismatch.
- Then fit the camera. Keep `--lambda` (default 25). It penalises moving away from the previous sample. Without it, a model that differs from the reference lets the camera jump between look-alike poses (one run moved it 230 m in 0.25 s).
- When the game shows a distance readout, trust it and fit only the angles: `--keys az,el,yaw,pitch,roll`. A free distance hides model mismatch by sliding the camera back (120–240 m on ring-run's panel B, so the core hole never opened).
- Results go into `cam_fix.json` and are interpolated into the scripted camera. Refit a panel after changing its model; keep the old table so you can revert.

## Keep only what scores

Test every model change against the stills and revert it if the panel's score drops, even when it looks closer. On ring-run these all looked plausible and scored lower: a larger ship, a funnel-shaped station and wings reaching the panel edges (`references/ring-run.md`). Change one thing per pass so each result is attributable. When three or four model changes in a row fail to help, render the full video, report and stop.

## 4. Score every pass

```bash
bash scripts/compare.sh stills SIM_DIR REF.mp4 out/itN 0.5,5,8.5,9.5   # read out/itN/pairs.png
bash scripts/compare.sh video REF.mp4 out/remake.mp4 out/final         # per-second, per-panel, side-by-side
```

Scores are blurred SSIM: the whole frame (960 wide, `gblur=4`) and each panel (450 px, `gblur=2`). The white margins and titles lift the whole-frame number, so judge the panels.

## 5. Sound

`score.py` synthesizes a rumble bed and band-limited whoosh bursts. Its `BURSTS` list comes from the reference's loudness every 0.1 s: `python3 -I score.py out.wav --ref REF.mp4` prints both side by side. Make the two channels mostly the same signal: independent channels read 3 dB quieter in a mono check.

## 6. Render

```bash
bash scripts/render.sh SIM_DIR out/remake.mp4
```

This builds, captures every frame (24 fps, 1876x1030), adds the score and verifies. Run it in the background; keep MP4s out of git and send them to the user.

## Worked example

`references/ring-run.md` has the measurements, the passes and the scores for the space-flight comparison this skill was built on.
