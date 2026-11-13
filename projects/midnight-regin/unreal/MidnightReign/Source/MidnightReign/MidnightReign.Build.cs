using System.IO;
using UnrealBuildTool;

public class MidnightReign : ModuleRules
{
	public MidnightReign(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"ChaosVehicles",
			"PhysicsCore"
		});

		// Folders inside this module are included as "Vehicles/MRVehiclePawn.h" etc.
		PublicIncludePaths.Add(ModuleDirectory);

		// Engine-independent gameplay maths shared with the unit tests:
		// <repo>/core/include  (this file is <repo>/unreal/MidnightReign/Source/MidnightReign).
		PublicIncludePaths.Add(Path.GetFullPath(
			Path.Combine(ModuleDirectory, "..", "..", "..", "..", "core", "include")));
	}
}
