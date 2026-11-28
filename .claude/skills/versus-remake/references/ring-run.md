# Worked example: ring-run (space-flight comparison)

The reference: 10.04 s, 1876x1030, 24 fps (241 frames), AAC 32 kHz stereo. Two browser games side by side, both "fly through the ring station core": a chase-camera fighter, a ring station in front of a planet and the same sci-fi HUD. A title and a build-time counter sit over each panel.

## Breakdown and stack

- **Panels:** three.js WebGL scenes with an HTML/CSS HUD (Inter labels, a monospace face for numbers), screen-recorded. Both games share the same HUD layout and the same reticle path, so they came from the same prompt.
- **Composite:** a video editor placed two 900x900 recordings with 20 px rounded corners at x = 30 and 946, y = 100. The title is bold dark sans, about 47 px; the counter is bold green, about 34 px.
- **Counters:** minutes.seconds, linear from 0 at 0.088 s to the final value at 9.543 s (A 18:00 = 1080 s, B 29:00 = 1740 s). Read from 41 strips 0.25 s apart; 0.47 → 1.16 is 47 s → 76 s.
- **Sound:** no music. An engine rumble bed (about −32 dB rms) with whoosh bursts at 2.3, 4.45, 5.4, 6.35, 7.25, 8.05 s and a swell at 9.05–9.75 s. Mean −27.2 dB, peak −8.5 dB.

## Measurements that drove the build

| What | How it was measured | Value |
|---|---|---|
| Mission clock | real time from the first frame | A 01:23.00, B 01:11.40 at t = 0 |
| Speed / energy / shield | stacked crops every 0.25 s, read once | tables in `data.js` |
| Distance to the core | readout; equals the integral of speed (km/h ÷ 3.6) | A 2083 m, B 2247 m at t = 0 |
| Station size | bracket size × distance ÷ focal | A outer ring 550 m, core disc about 220 m, hole 40 m |
| Planet | `fit_planet.py` at 9.5 s (camera looking straight ahead) | dir (−0.14, −0.53, −0.84), 54.1° (A); rms 0.15° |
| Alert blink | red pixels in the banner, per frame | on 7.72–7.80, 7.97–8.13, 8.30–8.47, 8.64–8.80 s |
| Success banner | green pixels, per frame | first frame 9.333 s |

## Passes (blurred SSIM; stills at 0.5 / 5 / 9.5 s, whole frame)

| Pass | Change | 0.5 s | 5 s | 9.5 s |
|---|---|---|---|---|
| 2 | first build with measured colours | 0.663 | 0.622 | 0.732 |
| 3 | stations scaled from the readouts | 0.658 | 0.623 | 0.722 |
| 5 | planet from the limb fit, ships raised | 0.675 | 0.651 | 0.750 |
| 7 | ship poses fitted (symmetric) | 0.683 | 0.659 | 0.763 |
| 8 | camera fitted every 0.25 s with smoothing | 0.731 | 0.678 | 0.753 |
| 13 | banded station B; panel B camera fitted with distance fixed to the readout | 0.733 | 0.692 | 0.763 |

Full videos, all frames:

| Version | Whole frame | Panel A | Panel B |
|---|---|---|---|
| v1 (pass 13) | 0.835 | 0.801 | 0.695 |
| v2 (final) | see below | | |

## What did not help (measured, then reverted)

- Ship A scaled up 13% to match its apparent size: −0.003 to −0.010 per still. The fit's distance was already right.
- Station B as a funnel (outer bands nearer the camera): −0.01 to −0.04 on panel B, even after refitting the camera.
- Ship B with wings spanning the full panel width: −0.01 everywhere. Straight bars do not line up with diagonal wings.
- A free distance in the camera fit: on panel B it pulled the camera 120–240 m back to hide the station mismatch, and the hole never opened. Fix the distance to the readout (`--keys az,el,yaw,pitch,roll`).

## What still differs

- **Rendering:** the reference panels look photographic: film-like light, fine greebles and grain. These procedural models are clean.
- **Panel B's ship:** the reference flies a recognisable film starfighter. The remake uses an original four-engine design on purpose, which costs about 0.05–0.1 on that panel.
- **Titles:** neutral labels ("Build A", "Build B") replace the model names on purpose. The counters match.
