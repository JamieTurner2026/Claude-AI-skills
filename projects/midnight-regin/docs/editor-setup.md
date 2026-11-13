# Steps that need Unreal Editor

Everything that could be prepared without the editor is already in the repo: C++ gameplay code,
the car, parts and track as FBX files, and a script that imports them and builds the test map.

Neither the C++ nor the import script has been run in Unreal yet. Expect to send some error
messages back for fixing; paste the full text from the Output Log.

## 1. Build the code

1. Install UE 5.6+ and the C++ toolchain for your platform.
2. Right-click `unreal/MidnightReign/MidnightReign.uproject` → *Generate project files* (use
   *Switch Unreal Engine version* first if you are not on 5.6).
3. Open the `.uproject` and accept the prompt to build the `MidnightReign` module. The editor
   will say the startup map is missing and open an empty level; that is expected until step 2.

## 2. Run the visual setup script

*Tools* → *Execute Python Script…* → choose `unreal/MidnightReign/Scripts/setup_visuals.py`.

It creates, under `Content/MidnightReign`:

- neon materials (`Materials/MI_MR_*`)
- the Solaris GT skeletal mesh, `DA_SolarisGT` tuning asset and `BP_MRVehicle`
- the customization part meshes
- the track meshes and the map `Maps/L_SolarisTestBlock` with checkpoint arches, night lighting
  and a Player Start
- `BP_MRGameMode`, set as the map's game mode

Open *Window* → *Output Log* and look for the `[MR setup] summary`. Each step reports `OK` or
`FAILED` with the manual alternative. The script can be run again safely.

## 3. Two manual steps (about five minutes)

**Physics asset.** Open `Vehicles/SolarisGT/SK_SolarisGT_PhysicsAsset`. Delete the bodies on the
four `Phys_Wheel_*` bones so only the `Root` body remains (wheels are simulated by Chaos, not by
physics bodies). Select the `Root` body and check it roughly covers the car body; if not,
right-click → *Regenerate Bodies* with *Primitive Type: Box*.

**Wheel animation.** Without this the car drives but the wheels do not visibly spin or steer.

1. Right-click in `Vehicles/SolarisGT` → *Animation* → *Animation Blueprint*. Pick the
   `SK_SolarisGT_Skeleton`, parent class **VehicleAnimationInstance**, name it `ABP_SolarisGT`.
2. In its AnimGraph: add *Mesh Space Ref Pose* → *Wheel Controller for WheeledVehicle* →
   *Component To Local* → *Output Pose*. Compile and save.
3. Open `BP_MRVehicle`, select **Mesh**, set *Anim Class* to `ABP_SolarisGT`.

## 4. Play

Open `Maps/L_SolarisTestBlock` and press **Play**.

- W/S/A/D or arrows drive, Space is nitro, Left Shift is the handbrake, R resets the car.
- Gamepad: triggers, left stick, A for nitro.
- The NITRO bar drains in about 4 seconds and refills after you release Space.
- *Tools* → *Session Frontend* → *Automation* → run the `MidnightReign` tests.

Handling changes (too fast, too slippery, twitchy steering) are made in `DA_SolarisGT` and in
Blueprint subclasses of `MRWheelFront` / `MRWheelRear`, with no code changes.

## If the script fails completely

Do it by hand: import `assets/export/SK_SolarisGT.fbx` as a Skeletal Mesh, import the
`assets/export/track/*.fbx` files as Static Meshes with *Collision Complexity: Use Complex
Collision As Simple*, drag the track meshes into a new level at 0,0,0, create `BP_MRVehicle`
(parent `MRVehiclePawn`) with the mesh assigned, and `BP_MRGameMode` (parent `MRGameMode`) with
that pawn. As a last resort the engine's sample car (*Add* → *Add Feature or Content Pack* →
*Vehicle*) uses the same wheel bone names and works as a stand-in.

## Commit the editor work

Commit the `Content/` folder. Set up Git LFS before it grows: `git lfs track "*.uasset" "*.umap"`.

## Not covered yet

Exhaust flames and sound for nitrous (the `OnBoostStarted` / `OnBoostStopped` events are ready
for a Niagara effect), on-screen touch controls, and attaching customization parts at runtime
(Milestone 4).
