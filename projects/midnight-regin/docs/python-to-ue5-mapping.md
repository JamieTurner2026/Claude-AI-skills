# From the Pygame prototype to Unreal Engine 5

## What the prototype does

`Car.update()` runs once per frame at 60 FPS and applies, in order:

1. **Throttle** (W / Up): `speed += 0.25`, capped at `max_speed = 10`.
2. **Brake / reverse** (S / Down): `speed -= 0.25`, down to `-5` (half of max).
3. **Friction** (no pedal): speed moves towards 0 by `0.05` per frame.
4. **Nitro** (Space, only when moving forward): `speed += 0.5`, capped at `15` (1.5 × max).
5. **Steering** (A/D / Left/Right, only above speed 0.2): angle changes by 4° per frame, reversed
   when reversing.
6. **Movement**: `x += cos(angle) * speed`, `y -= sin(angle) * speed`.
7. **Boundary**: position clamped 20 px inside the 800 × 600 window.

All numbers are *per frame*. They describe feel, not a real car, and they change if the frame rate
changes.

### Two findings

- **Nitro never reaches its cap with the throttle held.** Step 1 clamps speed back to 10 every
  frame before step 4 adds 0.5, so throttle + nitro tops out at 10.5 instead of 15. The full 15 is
  only reachable by releasing the throttle and holding Space. The port fixes this by default
  (`legacy_nitro_clamp=False`) and can reproduce the original exactly (`True`); both are tested.
- **Nitro is unlimited.** The Unreal version uses a tank that drains and refills.

## Per-second conversion (`prototype/python/reign_sim`)

| Prototype (per frame) | Per second |
|---|---|
| max speed 10 px | 600 px/s |
| acceleration 0.25 | 900 px/s² (0 → max in 0.67 s) |
| friction 0.05 | 180 px/s² (max → 0 in 3.3 s) |
| nitro 0.5 | 1800 px/s² |
| turn 4° | 240 °/s |
| steering threshold 0.2 | 12 px/s |

With `dt = 1/60` and legacy mode the port matches the original step for step; at 30, 120 and 240
FPS it gives the same speed and nearly the same path.

## Mapping to Unreal

| Prototype concept | Unreal Engine 5 implementation | Where |
|---|---|---|
| Throttle adds speed up to a cap | Throttle input → Chaos engine torque through an automatic gearbox; top speed comes from gearing, power and drag | `AMRVehiclePawn`, `UMRVehicleTuningData` |
| Brake, then reverse to half speed | Brake input; `bReverseAsBrake` selects reverse once stopped; reverse gear ratio limits reverse speed | `AMRVehiclePawn` |
| Friction when coasting | Engine braking (`EngineBrakeEffect`), drag coefficient, tyre rolling resistance | tuning asset |
| Same turn rate at any speed | Wheel steer angle, scaled from 100 % below 40 km/h to 25 % above 220 km/h, with smoothing for keyboard taps | `mr/Steering.h` |
| No steering when stopped | Emerges from physics: front wheels only turn the car when it rolls | Chaos |
| Steering flips in reverse | Emerges from physics | Chaos |
| Nitro adds speed, 1.5 × cap | Extra forward acceleration while boosting, cut off above a speed limit | `UMRNitrousComponent` |
| Unlimited nitro | Tank: capacity 100, drains 25/s (4 s), 1.5 s delay after release, refills 8/s, needs 10 to re-trigger | `mr/Nitrous.h` |
| (none) | Events `OnBoostStarted / OnBoostStopped / OnDepleted` for exhaust flames, sound, camera | `UMRNitrousComponent` |
| `cos/sin` position update | Rigid body with mass, momentum, suspension and tyre grip | Chaos Vehicles |
| Window clamp | Collision with the world | Chaos |
| 60 FPS loop | Everything uses delta time; physics sub-stepping enabled | `Config/DefaultEngine.ini` |
| WASD / arrows / Space | Enhanced Input: same keys plus gamepad, Shift handbrake, R reset | `UMRInputConfig` |
| Top-down view | Chase camera on a spring arm with lag; wider field of view while boosting | `AMRVehiclePawn` |
| HUD help text | Canvas HUD: controls hint, speed, gear, nitrous bar in the neon cyan / pink palette | `AMRDrivingHUD` |

The prototype's arcade speed rules also live on as `mr::StepArcadeDrive` (`core/include/mr/DrivingModel.h`),
kept as a tested reference and a cheap model for simple AI or ghost cars later.

## Starting values for the first car

Mass 1500 kg, 650 N·m, 7500 rpm, 6 gears, rear-wheel drive, tyre friction multiplier about 3
(grippier than reality for an arcade feel), centre of mass lowered 20 cm. These are a starting
point to tune by driving, not a specification.
