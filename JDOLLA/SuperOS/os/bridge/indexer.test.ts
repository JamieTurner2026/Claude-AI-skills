import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildState, parseDepartment, parseDirectives } from "./indexer.ts";
import { loadConfig, pathsFor } from "./config.ts";
import { makeVault } from "./fixture.ts";

const realOs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
