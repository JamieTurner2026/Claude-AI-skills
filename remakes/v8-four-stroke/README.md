# V8 Four-Stroke: reverse-engineered remake

This is a remake of video 1 from Elvar's X article
"How I Turn Any Machine Into a 3D Simulator You Can Take Apart" (posted 30 Oct 2026).
Video 1 is the V8 clip: "the throttle opens to 2,400 rpm, cylinder 4 cut open, then cylinder 2, back to idle, played at 1/20 speed".

## What the reference is

| | |
|---|---|
| Container | MP4, H.264 1920×1080 @ 60 fps, 1,560 frames, 26.05 s; AAC 48 kHz stereo, mean −16 dB |
| Look | A pale studio (#e9eaeb-ish) with soft contact shadows and a black glossy engine with glass cylinder liners. Red (#d71f2b) is the one accent. Inter for UI text, JetBrains Mono for numbers. |
| Layout | A fixed 1600×900 CSS console scaled to 1080p. Top left: title, a big rpm readout and a rev bar. Left panels: slider-crank and cross-plane crank schematics. Right panels: tracked-cylinder stroke and chamber pressure, valve-timing chart (0–720°), indicator (p-V) diagram. Bottom: firing-order picker, play/speed controls, camera, cutaway and overlay buttons. Thin leader lines run from the panels into the engine. |
| Motion | Everything comes from one crank angle. The crank turns at rpm × 1/20, so 700 rpm gives 210°/s on screen. An "operator" cursor walks to each button and clicks it, with a ring pulse. |

### Beat sheet (measured every 0.25 s from the post)

| t (s) | Event | Camera |
|---|---|---|
| 0.0 | Opens behind the flywheel quarter and swings onto the SIDE view. Tracks cylinder 7, which starts at 12° after TDC. | open → side |
| 2.4 | The cursor drags the engine-speed slider from 700 to 2,400 rpm over 1.4 s. | side |
| 5.4 | VALLEY | top-down into the V |
| 7.9 | Firing order: track cylinder 4 | valley |
| 9.7 | CYL: cylinder 4 is isolated and cut open, and the charge burns in the glass liner | close orbit |
| 12.9 | Firing order: track cylinder 2. The camera glides to it. | cyl |
| 15.9 | FRONT | front |
| 18.6 | HERO | 3/4 hero, slow drift |
| 22.1 | Throttle back to 700 rpm over 1.4 s | hero |

## The tech stack (confirmed, not guessed)

The article names the tool and the code is public: the **teardown** Claude Code skill
(github.com/elvarofficial/teardown, MIT, built on whaleyxbt/claude-motion). It was built with
Claude Code running Opus 5.5.

- **three.js 0.186** WebGL. Every part is built in code: lathed liners and pistons, gears, cams and springs. There are no imported models. GTAO and bloom post-processing, soft shadows on an invisible floor.
- **Plain DOM/CSS overlay** at a fixed 1600×900. The charts are canvas, redrawn every frame from the same model. Fonts are `@fontsource-variable/inter` and `@fontsource/jetbrains-mono`.
- **One model, `kin.js`**: an exact slider-crank `s = r·cosφ + √(L² − r²sin²φ)` with r 4.4 cm and L 14.5 cm, a 90° cross-plane crank, firing order 1-8-4-3-6-5-7-2 and a chamber-pressure model. The pistons, valves, charts and numbers all read from it.
- **`film.js`**: a `SCRIPT` of operator beats. `render(t)` is a pure function of time, so every frame is deterministic.
- **esbuild** bundles it into one offline HTML file of about 800 KB.
- **Playwright headless Chromium** steps `SIM.render(t)` frame by frame and screenshots each frame. ffmpeg encodes them to H.264, yuv420p, faststart.
- **Python stdlib synth** (`sfx/`): Am9–Fmaj7–Cmaj7–G6 chords at 92 bpm, a soft thump on every power stroke (one per 90° of crank, so the beat tightens with the throttle), clicks on button presses and air on the throttle drag. It is mastered to −14 LUFS.

## How this remake was made

The public repo has a newer film script than the one in the post: it opens on HERO, tracks cylinder 1 and uses different beat times. I kept the engine, stage and console unchanged and rewrote only the operator script to match the post:

- `src/v8-shared/film_post.js` is a copy of `film.js` with these changes (see `film_post.diff`):
  - the measured beat sheet above;
  - two throttle ramps;
  - a crank start of 552°, so cylinder 7 reads 12° at t = 0;
  - a new opening camera move;
  - a slower HERO drift (54° + 1.6°/s).
- `src/v8-shared/score_post.py` moves the score's clicks, air swells and throttle ramps onto the new beats. It produces 187 sounds; the article says the post had 189.

Loop used (`compare.sh`): render stills, pair them with the reference at the same time, read the pairs, fix, repeat. Seven passes:

| Pass | Fix |
|---|---|
| 1 | Beat timings measured from 0.25 s strips of the rpm, cylinder, camera and firing-order widgets |
| 2 | Crank phase: every gauge, chart and crank angle now reads the same as the post |
| 3–7 | Opening move, throttle-down time, HERO drift and distance |

**Result.** Blurred SSIM against the post is about 0.83–0.88 on wide shots and 0.91–0.99 on the valley and cylinder shots. The numbers on screen match the post frame for frame. What still differs:

- **Lighting:** frames rendered here use software WebGL (SwiftShader), so the ambient occlusion and shadow softness differ slightly from the GPU original.
- **Opening:** the first 1.5 s camera swing is fitted by eye, not measured.
- **Cursor:** its path between clicks follows the kit's own rest points, not the original's.

It is a close rebuild, not a pixel copy.

## Run it

```bash
bash setup.sh            # clones teardown @a91262a, adds the remake files, builds the page
bash render.sh           # → work/teardown/teardown-out/full/v8-remake.mp4
bash compare.sh path/to/reference.mp4 out/cmp 0.5,6,13,21
```

Needs Node 20+, ffmpeg and Python 3. Set `CHROMIUM=/path/to/chrome` to use an installed browser.
