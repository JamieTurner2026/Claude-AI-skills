using UnrealBuildTool;
using System.Collections.Generic;

public class MidnightReignTarget : TargetRules
{
	public MidnightReignTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("MidnightReign");
	}
}
