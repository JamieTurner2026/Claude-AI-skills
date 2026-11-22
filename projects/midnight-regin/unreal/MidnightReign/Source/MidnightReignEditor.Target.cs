using UnrealBuildTool;
using System.Collections.Generic;

public class MidnightReignEditorTarget : TargetRules
{
	public MidnightReignEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("MidnightReign");
	}
}
