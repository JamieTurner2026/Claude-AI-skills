# Systems added in Milestone 1

## Core (`core/include/mr`) — plain C++17, unit tested

| Header | Purpose |
|---|---|
| `Math.h` | Clamp, lerp, smoothstep, move-towards (no STL, safe to include from Unreal) |
| `Nitrous.h` | `NitrousTank`: drain, release-gated delayed refill, minimum to activate, events per update, upgrade-safe `SetConfig` |
| `Steering.h` | `SteeringScaleForSpeed`, `SmoothSteeringInput` |
| `DrivingModel.h` | `StepArcadeDrive`: the prototype's speed/turn rules per second |

Rule: gameplay maths that does not need the engine goes here with a test; Unreal classes wrap it.

## Unreal module (`unreal/MidnightReign/Source/MidnightReign`)

| Class | Purpose | Blueprint surface |
|---|---|---|
| `AMRVehiclePawn` | Player car on Chaos Vehicles; input → vehicle, steering scaling, chase camera, reset | `Set*Input`, `ResetVehicle`, `GetSpeedKmh`, `GetCurrentGear`, `GetEngineRPM`, `GetNitrous`, `Tuning` |
| `UMRNitrousComponent` | Tank + boost push for any physics actor | `Settings`, `ApplySettings`, `Refill`, `IsBoosting`, `GetNitrousFraction`, events `OnBoostStarted/Stopped/Depleted` |
| `UMRVehicleTuningData` | One data asset per car: chassis, engine, gearbox, drivetrain, wheels, steering, nitrous, `VehicleId` | Editable asset |
| `UMRWheelFront` / `UMRWheelRear` | Default wheel/tyre/suspension values | Subclass per car |
| `UMRInputConfig` | Enhanced Input actions and default bindings created in code | Actions readable |
| `AMRGameMode` | Spawns the car and HUD | Subclass to pick a vehicle Blueprint |
| `AMRDrivingHUD` | Canvas HUD, read-only | Colours, hint toggle |
| `Tests/MRDrivingTests.cpp` | Automation tests for settings conversion, bindings, pawn defaults, tuning application | Session Frontend → Automation → "MidnightReign" |

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | W / Up | Right trigger |
| Brake / reverse | S / Down | Left trigger |
| Steer | A, D / Left, Right | Left stick |
| Nitrous | Space | A (bottom) |
| Handbrake | Left Shift | B (right) |
| Reset car | R | Y (top) |

Touch: build UMG buttons / a virtual stick that call the pawn's `Set*Input` functions.
Racing wheel: planned for Milestone 6 through the same axes.

## Not in this milestone

Exhaust-flame particles and sound (events are ready for them), nitrous upgrades (settings are
data-driven and `ApplySettings` keeps the fill level), ground-contact check for boost, touch UI,
any networking or database work.
