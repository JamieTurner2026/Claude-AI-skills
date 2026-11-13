"""One-time visual setup for MIDNIGHT REIGN. Run inside Unreal Editor (5.6+):

    Tools > Execute Python Script... > unreal/MidnightReign/Scripts/setup_visuals.py

Prerequisite: the MidnightReign C++ module has compiled (the script uses the
MRVehiclePawn, MRGameMode and MRVehicleTuningData classes).

It imports the generated FBX files from <repo>/assets/export and creates, under
/Game/MidnightReign:
  Materials/   M_MR_Master + one material instance per M_MR_* slot (from materials.json)
  Vehicles/    SK_SolarisGT (+ skeleton, physics asset), DA_SolarisGT, BP_MRVehicle
  Parts/       wheel, spoiler and bumper static meshes
  Track/       the Solaris Coast test block meshes
  Core/        BP_MRGameMode
  Maps/        L_SolarisTestBlock (track, checkpoint arches, night lighting, Player Start)

Safe to run again: existing assets are reused or re-imported.

STATUS: written without access to Unreal Editor and not yet executed. Every
step is isolated; a failed step is reported in the summary (Output Log) with
the manual alternative from docs/editor-setup.md, and the rest still runs.
"""
import json
import os
import traceback

import unreal

ROOT = "/Game/MidnightReign"
MAP_PATH = ROOT + "/Maps/L_SolarisTestBlock"
PROJECT_DIR = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
EXPORT_DIR = os.path.normpath(os.path.join(PROJECT_DIR, "..", "..", "assets", "export"))

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary

RESULTS = []


def log(msg):
    unreal.log("[MR setup] " + msg)


def step(name, manual_hint=""):
    """Decorator: run a step, record success/failure, never abort the whole script."""
    def wrap(fn):
        def run(*args, **kwargs):
            try:
                value = fn(*args, **kwargs)
                RESULTS.append((name, True, ""))
                return value
            except Exception as exc:  # noqa: BLE001
                unreal.log_error("[MR setup] %s failed: %s\n%s" % (name, exc, traceback.format_exc()))
                RESULTS.append((name, False, manual_hint))
                return None
        return run
    return wrap


def read_json(name):
    with open(os.path.join(EXPORT_DIR, name), "r") as handle:
        return json.load(handle)


def srgb_hex_to_linear(hex_color):
    h = hex_color.lstrip("#")
    r, g, b = (pow(int(h[i:i + 2], 16) / 255.0, 2.2) for i in (0, 2, 4))
    return unreal.LinearColor(r, g, b, 1.0)


def load_or_create(name, folder, asset_class, factory):
    path = "%s/%s" % (folder, name)
    if eal.does_asset_exist(path):
        return eal.load_asset(path)
    return asset_tools.create_asset(name, folder, asset_class, factory)


# ------------------------------------------------------------------ materials

@step("Materials", "Create materials by hand and assign them to the M_MR_* slots.")
def create_materials():
    folder = ROOT + "/Materials"
    master_path = folder + "/M_MR_Master"
    if eal.does_asset_exist(master_path):
        master = eal.load_asset(master_path)
    else:
        master = asset_tools.create_asset("M_MR_Master", folder, unreal.Material, unreal.MaterialFactoryNew())

        def param(cls, name, x, y):
            node = mel.create_material_expression(master, cls, x, y)
            node.set_editor_property("parameter_name", name)
            return node

        base = param(unreal.MaterialExpressionVectorParameter, "BaseColor", -600, -300)
        base.set_editor_property("default_value", unreal.LinearColor(0.5, 0.5, 0.5, 1.0))
        metallic = param(unreal.MaterialExpressionScalarParameter, "Metallic", -600, -100)
        roughness = param(unreal.MaterialExpressionScalarParameter, "Roughness", -600, 0)
        roughness.set_editor_property("default_value", 0.5)
        emissive_color = param(unreal.MaterialExpressionVectorParameter, "EmissiveColor", -800, 150)
        emissive_color.set_editor_property("default_value", unreal.LinearColor(0.0, 0.0, 0.0, 1.0))
        emissive_strength = param(unreal.MaterialExpressionScalarParameter, "EmissiveStrength", -800, 350)
        multiply = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -500, 200)
        mel.connect_material_expressions(emissive_color, "", multiply, "A")
        mel.connect_material_expressions(emissive_strength, "", multiply, "B")

        mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
        mel.connect_material_property(metallic, "", unreal.MaterialProperty.MP_METALLIC)
        mel.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)
        mel.connect_material_property(multiply, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        mel.recompile_material(master)
        eal.save_loaded_asset(master)

    instances = {}
    for slot_name, values in read_json("materials.json")["materials"].items():
        instance = load_or_create(slot_name.replace("M_MR_", "MI_MR_"), folder,
                                  unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(instance, master)
        color = srgb_hex_to_linear(values["color"])
        mel.set_material_instance_vector_parameter_value(instance, "BaseColor", color)
        mel.set_material_instance_scalar_parameter_value(instance, "Metallic", values["metallic"])
        mel.set_material_instance_scalar_parameter_value(instance, "Roughness", values["roughness"])
        if values["emissive_strength"] > 0:
            mel.set_material_instance_vector_parameter_value(instance, "EmissiveColor", color)
            mel.set_material_instance_scalar_parameter_value(instance, "EmissiveStrength", values["emissive_strength"])
        mel.update_material_instance(instance)
        eal.save_loaded_asset(instance)
        instances[slot_name] = instance
    log("%d material instances ready" % len(instances))
    return instances


# -------------------------------------------------------------------- import

def import_fbx(relative_path, destination, skeletal=False):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", os.path.join(EXPORT_DIR, relative_path))
    task.set_editor_property("destination_path", destination)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)

    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_materials", False)   # slots keep their M_MR_* names; instances are assigned below
    options.set_editor_property("import_textures", False)
    options.set_editor_property("import_animations", False)
    options.set_editor_property("import_as_skeletal", skeletal)
    if skeletal:
        options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
        options.set_editor_property("create_physics_asset", True)
    else:
        options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
        static_data = options.get_editor_property("static_mesh_import_data")
        static_data.set_editor_property("combine_meshes", True)
        static_data.set_editor_property("auto_generate_collision", False)
    task.set_editor_property("options", options)

    asset_tools.import_asset_tasks([task])
    asset_name = os.path.splitext(os.path.basename(relative_path))[0]
    asset = eal.load_asset("%s/%s" % (destination, asset_name))
    if asset is None:
        raise RuntimeError("Import produced no asset for " + relative_path)
    return asset


def assign_static_materials(mesh, instances):
    for index, slot in enumerate(mesh.get_editor_property("static_materials")):
        name = str(slot.get_editor_property("imported_material_slot_name"))
        if name not in instances:
            name = str(slot.get_editor_property("material_slot_name"))
        if name in instances:
            mesh.set_material(index, instances[name])
    eal.save_loaded_asset(mesh)


def assign_skeletal_materials(mesh, instances):
    slots = mesh.get_editor_property("materials")
    for slot in slots:
        name = str(slot.get_editor_property("imported_material_slot_name"))
        if name not in instances:
            name = str(slot.get_editor_property("material_slot_name"))
        if name in instances:
            slot.set_editor_property("material_interface", instances[name])
    mesh.set_editor_property("materials", slots)
    eal.save_loaded_asset(mesh)


def use_complex_collision(mesh):
    """Drive on the render triangles: fine for static scenery and needs no hand-made collision hulls."""
    body_setup = mesh.get_editor_property("body_setup")
    body_setup.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
    eal.save_loaded_asset(mesh)


@step("Import vehicle", "Import assets/export/SK_SolarisGT.fbx as a Skeletal Mesh (create Physics Asset on).")
def import_vehicle(instances):
    info = read_json("solaris_gt.json")
    mesh = import_fbx(info["fbx"], ROOT + "/Vehicles/SolarisGT", skeletal=True)
    if instances:
        assign_skeletal_materials(mesh, instances)
    return mesh


@step("Import parts", "Import assets/export/parts/*.fbx as Static Meshes.")
def import_parts(instances):
    meshes = {}
    for part in read_json("parts.json")["parts"]:
        mesh = import_fbx(part["fbx"], ROOT + "/Parts")
        if instances:
            assign_static_materials(mesh, instances)
        meshes[part["name"]] = mesh
    return meshes


@step("Import track", "Import assets/export/track/*.fbx as Static Meshes; set Collision Complexity to 'Use Complex Collision As Simple'.")
def import_track(instances):
    meshes = {}
    for entry in read_json("track_layout.json")["meshes"]:
        mesh = import_fbx(entry["fbx"], ROOT + "/Track")
        if instances:
            assign_static_materials(mesh, instances)
        if entry["collision"] == "complex":
            use_complex_collision(mesh)
        meshes[entry["name"]] = mesh
    return meshes


# ------------------------------------------------------- gameplay assets

@step("Tuning data asset", "Create a Data Asset of class MRVehicleTuningData named DA_SolarisGT.")
def create_tuning_asset():
    info = read_json("solaris_gt.json")
    factory = unreal.DataAssetFactory()
    factory.set_editor_property("data_asset_class", unreal.MRVehicleTuningData)
    asset = load_or_create("DA_SolarisGT", ROOT + "/Vehicles/SolarisGT", unreal.MRVehicleTuningData, factory)
    asset.set_editor_property("vehicle_id", unreal.Name(info["id"]))
    asset.set_editor_property("display_name", unreal.Text(info["display_name"]))
    asset.set_editor_property("wheel_bone_names", [unreal.Name(b) for b in info["bones"][1:]])
    eal.save_loaded_asset(asset)
    return asset


def create_blueprint(name, folder, parent_class):
    path = "%s/%s" % (folder, name)
    if eal.does_asset_exist(path):
        return eal.load_asset(path)
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", parent_class)
    return asset_tools.create_asset(name, folder, unreal.Blueprint, factory)


@step("Vehicle Blueprint", "Create Blueprint BP_MRVehicle (parent MRVehiclePawn); set Mesh > Skeletal Mesh Asset to SK_SolarisGT and Tuning to DA_SolarisGT.")
def create_vehicle_blueprint(skeletal_mesh, tuning):
    blueprint = create_blueprint("BP_MRVehicle", ROOT + "/Vehicles/SolarisGT", unreal.MRVehiclePawn)
    defaults = unreal.get_default_object(blueprint.generated_class())
    if tuning:
        defaults.set_editor_property("tuning", tuning)
    if skeletal_mesh:
        mesh_component = defaults.get_editor_property("mesh")
        mesh_component.set_editor_property("skeletal_mesh_asset", skeletal_mesh)
    unreal.BlueprintEditorLibrary.compile_blueprint(blueprint)
    eal.save_loaded_asset(blueprint)
    return blueprint


@step("Game mode Blueprint", "Create Blueprint BP_MRGameMode (parent MRGameMode); set Default Pawn Class to BP_MRVehicle.")
def create_game_mode_blueprint(vehicle_blueprint):
    blueprint = create_blueprint("BP_MRGameMode", ROOT + "/Core", unreal.MRGameMode)
    if vehicle_blueprint:
        defaults = unreal.get_default_object(blueprint.generated_class())
        defaults.set_editor_property("default_pawn_class", vehicle_blueprint.generated_class())
    unreal.BlueprintEditorLibrary.compile_blueprint(blueprint)
    eal.save_loaded_asset(blueprint)
    return blueprint


# ---------------------------------------------------------------------- map

@step("Test map", "Create a level, drag the SM_Track_* meshes in at 0,0,0, add a Player Start on the bottom straight.")
def create_map(track_meshes, game_mode_blueprint):
    layout = read_json("track_layout.json")
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    if eal.does_asset_exist(MAP_PATH):
        levels.load_level(MAP_PATH)
        for actor in actors.get_all_level_actors():
            if actor.get_actor_label().startswith("MR_"):
                actors.destroy_actor(actor)
    else:
        levels.new_level(MAP_PATH)

    origin = unreal.Vector(0.0, 0.0, 0.0)
    no_rotation = unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0)

    for entry in layout["meshes"]:
        mesh = track_meshes.get(entry["name"])
        if mesh is None or not entry["place_at_origin"]:
            continue
        actor = actors.spawn_actor_from_object(mesh, origin, no_rotation)
        actor.set_actor_label("MR_" + entry["name"])
        if entry["collision"] == "none":
            actor.set_actor_enable_collision(False)

    arch = track_meshes.get("SM_Checkpoint_Arch")
    for checkpoint in layout["checkpoints"]:
        if arch is None:
            break
        x, y, z = checkpoint["location"]
        actor = actors.spawn_actor_from_object(arch, unreal.Vector(x, y, z),
                                               unreal.Rotator(roll=0.0, pitch=0.0, yaw=checkpoint["yaw"]))
        actor.set_actor_label("MR_Checkpoint_%02d" % checkpoint["index"])

    x, y, z = layout["player_start"]["location"]
    start = actors.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(x, y, z + 40.0),
                                          unreal.Rotator(roll=0.0, pitch=0.0, yaw=layout["player_start"]["yaw"]))
    start.set_actor_label("MR_PlayerStart")

    # Night lighting: faint moonlight, sky, light fog, bloom for the neon.
    moon = actors.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 5000.0),
                                         unreal.Rotator(roll=0.0, pitch=-35.0, yaw=40.0))
    moon.set_actor_label("MR_Moonlight")
    moon_light = moon.get_component_by_class(unreal.DirectionalLightComponent)
    moon_light.set_editor_property("intensity", 0.6)
    moon_light.set_editor_property("light_color", unreal.Color(r=150, g=175, b=255, a=255))

    actors.spawn_actor_from_class(unreal.SkyAtmosphere, origin, no_rotation).set_actor_label("MR_SkyAtmosphere")
    sky = actors.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0.0, 0.0, 3000.0), no_rotation)
    sky.set_actor_label("MR_SkyLight")
    sky_component = sky.get_component_by_class(unreal.SkyLightComponent)
    sky_component.set_editor_property("real_time_capture", True)
    sky_component.set_editor_property("intensity", 1.5)

    fog = actors.spawn_actor_from_class(unreal.ExponentialHeightFog, origin, no_rotation)
    fog.set_actor_label("MR_Fog")

    post = actors.spawn_actor_from_class(unreal.PostProcessVolume, origin, no_rotation)
    post.set_actor_label("MR_PostProcess")
    post.set_editor_property("unbound", True)
    settings = post.get_editor_property("settings")
    settings.set_editor_property("override_bloom_intensity", True)
    settings.set_editor_property("bloom_intensity", 1.2)
    settings.set_editor_property("override_auto_exposure_bias", True)
    settings.set_editor_property("auto_exposure_bias", 0.5)
    post.set_editor_property("settings", settings)

    if game_mode_blueprint:
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        world.get_world_settings().set_editor_property("default_game_mode", game_mode_blueprint.generated_class())

    levels.save_current_level()
    return MAP_PATH


def main():
    if not os.path.isdir(EXPORT_DIR):
        unreal.log_error("[MR setup] Cannot find %s. Run this from the project inside the midnight-reign repo." % EXPORT_DIR)
        return
    for cls in ("MRVehiclePawn", "MRGameMode", "MRVehicleTuningData"):
        if not hasattr(unreal, cls):
            unreal.log_error("[MR setup] Class %s not found. Compile the MidnightReign C++ module first." % cls)
            return

    instances = create_materials() or {}
    skeletal_mesh = import_vehicle(instances)
    import_parts(instances)
    track_meshes = import_track(instances) or {}
    tuning = create_tuning_asset()
    vehicle_blueprint = create_vehicle_blueprint(skeletal_mesh, tuning)
    game_mode_blueprint = create_game_mode_blueprint(vehicle_blueprint)
    create_map(track_meshes, game_mode_blueprint)

    log("---------------- summary ----------------")
    for name, ok, hint in RESULTS:
        if ok:
            log("OK      " + name)
        else:
            unreal.log_warning("[MR setup] FAILED  %s  -> manual: %s" % (name, hint))
    log("Remaining manual steps: wheel Animation Blueprint and physics asset clean-up (docs/editor-setup.md).")


main()
