// Builds a small throwaway vault for tests.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeVault(): string {
  const vault = mkdtempSync(path.join(tmpdir(), "superos-vault-"));
  for (const d of ["os/config", "depts", "wiki/software", "wiki/ai", "raw/software/charter", "routines", "apps", "outputs/2026-11"]) mkdirSync(path.join(vault, d), { recursive: true });
  writeFileSync(path.join(vault, "os/config/os.config.json"), JSON.stringify({
    owner: "Test", brand: "T$", timezones: ["America/New_York"],
    engine: { t2: { model: "haiku", effort: "low" }, t3: { model: "opus", effort: "high", permissionMode: "acceptEdits", maxBudgetUsd: 2 } },
    artifactRoots: ["outputs"], pinnedSkills: [], layout: [{ widget: "clock", span: 1 }],
  }));
  writeFileSync(path.join(vault, "depts/software.md"), "# Software Engineering: router\nBuilds software.\n\n## Skills\n- `/repo-builder`: start a project\n- `/repo-ship`: ship it\n\n## Notes\n- [[wiki/software/a]]\n");
  writeFileSync(path.join(vault, "depts/ai.md"), "# AI Research: router\nThinks.\n\n## Skills\n");
  writeFileSync(path.join(vault, "wiki/software/a.md"), "a");
  writeFileSync(path.join(vault, "wiki/software/_index.md"), "generated");
  mkdirSync(path.join(vault, ".claude"), { recursive: true });
  writeFileSync(path.join(vault, "os/config/skills.policy.json"), JSON.stringify({ defaultTools: ["Read", "Glob", "Grep", "Write", "Edit"], skills: { builder: { tools: ["Bash"] } } }));
  writeFileSync(path.join(vault, ".claude/settings.json"), JSON.stringify({ permissions: { deny: ["Edit(/os/**)", "Write(/CLAUDE.md)", "Read(/**/.env*)", "Bash(rm -rf *)"] } }));
  writeFileSync(path.join(vault, "wiki/directives.md"), "# Directives\n\n- [ ] First thing\n- [x] Done thing\nnot a directive\n");
  writeFileSync(path.join(vault, "raw/software/charter/brief.md"), "x");
  writeFileSync(path.join(vault, "routines/routines.json"), "[]");
  writeFileSync(path.join(vault, "apps/apps.json"), "[]");
  return vault;
}
