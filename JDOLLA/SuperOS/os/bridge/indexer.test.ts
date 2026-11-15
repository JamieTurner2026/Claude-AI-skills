import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildState, parseDepartment, parseDirectives } from "./indexer.ts";
import { loadConfig, pathsFor } from "./config.ts";

const realOs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  writeFileSync(path.join(vault, "wiki/directives.md"), "# Directives\n\n- [ ] First thing\n- [x] Done thing\nnot a directive\n");
  writeFileSync(path.join(vault, "raw/software/charter/brief.md"), "x");
  writeFileSync(path.join(vault, "routines/routines.json"), "[]");
  writeFileSync(path.join(vault, "apps/apps.json"), "[]");
  return vault;
}

test("parses a department router", () => {
  const d = parseDepartment("software", "# Software Engineering & Development: router\nTurns ideas into software.\n\n## Skills\n- `/repo-builder`: start a new project\n\n## References\n- `/not-a-skill`: wrong section\n");
  assert.equal(d.name, "Software Engineering & Development");
  assert.equal(d.summary, "Turns ideas into software.");
  assert.deepEqual(d.skills, [{ name: "repo-builder", description: "start a new project" }]);
});

test("parses directives and ignores other lines", () => {
  const ds = parseDirectives("# x\n- [ ] one\n- [x] two\n- three\n  - [ ] indented\n");
  assert.deepEqual(ds.map((d) => [d.text, d.done]), [["one", false], ["two", true]]);
  assert.notEqual(ds[0]?.id, ds[1]?.id);
});

test("builds state from a fixture vault", () => {
  const p = pathsFor(path.join(makeVault(), "os"));
  const s = buildState(p, loadConfig(p));
  assert.deepEqual(s.departments.map((d) => d.slug), ["ai", "software"]);
  assert.equal(s.departments[1]?.noteCount, 1, "_index.md is not counted");
  assert.deepEqual(s.counts, { wiki: 1, raw: 1, outputs: 0 });
  assert.equal(s.directives.length, 2);
  assert.deepEqual(s.warnings, []);
});

test("bad routines file becomes a warning, not a crash", () => {
  const vault = makeVault();
  writeFileSync(path.join(vault, "routines/routines.json"), "{not json");
  const p = pathsFor(path.join(vault, "os"));
  const s = buildState(p, loadConfig(p));
  assert.deepEqual(s.routines, []);
  assert.equal(s.warnings.length, 1);
});

test("the real vault indexes to seven departments with skills", () => {
  const p = pathsFor(realOs);
  const s = buildState(p, loadConfig(p));
  assert.equal(s.departments.length, 7);
  assert.ok(s.departments.find((d) => d.slug === "software")?.skills.length);
  assert.ok(s.counts.wiki > 0 && s.counts.raw > 0);
  assert.ok(s.directives.length > 0);
  assert.deepEqual(s.warnings, []);
});
