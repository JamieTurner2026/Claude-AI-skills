# Install these skills for your user so they are available in every folder (Claude Code: %USERPROFILE%\.claude\skills).
# Windows version of install.sh. No network, no admin.
# Usage (PowerShell, in the repo root):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1          copy (re-run to update)
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Check   show what is installed
param([switch]$Check)
$ErrorActionPreference = "Stop"
$Src = Join-Path $PSScriptRoot ".claude\skills"
if (-not (Test-Path -LiteralPath $Src -PathType Container)) { throw "No .claude\skills folder next to this script: $Src" }
$Dst = if ($env:CLAUDE_SKILLS_DIR) { $env:CLAUDE_SKILLS_DIR } else { Join-Path $env:USERPROFILE ".claude\skills" }
$Skills = Get-ChildItem -LiteralPath $Src -Directory | Sort-Object Name
if ($Check) {
  foreach ($s in $Skills) {
    if (Test-Path -LiteralPath (Join-Path (Join-Path $Dst $s.Name) "SKILL.md") -PathType Leaf) { "installed: $($s.Name)" } else { "missing:   $($s.Name)" }
  }
  exit 0
}
New-Item -ItemType Directory -Force -Path $Dst | Out-Null
foreach ($s in $Skills) {
  $target = Join-Path $Dst $s.Name
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Copy-Item -LiteralPath $s.FullName -Destination $target -Recurse
  "installed $($s.Name) -> $target"
}
"Done: $($Skills.Count) skills. Restart Claude Code, then type / to see them (e.g. /blender-core, /unreal-cpp-gameplay)."
