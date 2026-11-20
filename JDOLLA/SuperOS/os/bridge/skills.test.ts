// Skill listing: name, description, tier and budget from SKILL.md, and what happens to files we cannot read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeVault } from "./fixture.ts";
import { pathsFor } from "./config.ts";
import { loadPolicy, scriptToolsFor, t3Tools } from "./policy.ts";
import { MAX_SKILL_BYTES, UNKNOWN_BUDGET_USD, findSkill, listSkills, parseSkill } from "./skills.ts";

const realOs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GOOD = "---\nname: demo\ndescription: Does a demo thing. Use when asked.\n---\n# Demo\n\nDepartment: Strategy. Tier: **T2, read-only** (reads the vault). Suggested budget: **$0.25 per run** (guess).\n";

test("reads name, description, tier and budget", () => {
  const s = parseSkill("demo", GOOD);
  assert.deepEqual(s, { name: "demo", description: "Does a demo thing. Use when asked.", tier: "T2", tierKnown: true, budgetUsd: 0.25, budgetKnown: true, runnable: true, problem: null });
  const t3 = parseSkill("x", GOOD.replace("T2, read-only", "T3").replace("$0.25 per run", "$1.00 per run"));
  assert.deepEqual([t3.tier, t3.budgetUsd], ["T3", 1]);
  assert.equal(parseSkill("x", GOOD.replace("$0.25", "$0.5")).budgetUsd, 0.5);
});

test("a line that cannot be parsed shows unknown and defaults to T2 and $0.05", () => {
  for (const [label, text] of [
    ["no tier line", GOOD.replace("Tier: **T2, read-only** ", "")],
    ["tier T9", GOOD.replace("**T2, read-only**", "**T9**")],
    ["tier not bold", GOOD.replace("**T2, read-only**", "T2")],
  ] as const) {
    const s = parseSkill("demo", text);
    assert.equal(s.tierKnown, false, label);
    assert.equal(s.tier, "T2", label);
    assert.ok(s.problem?.includes("Tier"), label);
  }
  for (const [label, text] of [
    ["no budget line", GOOD.replace(/Suggested budget: \*\*\$0.25 per run\*\*/, "")],
    ["budget words", GOOD.replace("$0.25", "$abc")],
    ["budget zero", GOOD.replace("$0.25", "$0")],
    ["budget huge", GOOD.replace("$0.25", "$999")],
    ["budget with junk", GOOD.replace("$0.25 per run", "$0.25.5")],
  ] as const) {
    const s = parseSkill("demo", text);
    assert.equal(s.budgetKnown, false, label);
    assert.equal(s.budgetUsd, UNKNOWN_BUDGET_USD, label);
  }
  // one bad line does not spoil the other: tier known, budget unknown
  const half = parseSkill("demo", GOOD.replace("$0.25", "$abc"));
  assert.deepEqual([half.tier, half.tierKnown, half.budgetKnown], ["T2", true, false]);
});

test("malformed files never throw", () => {
  const cases = ["", "\n\n", "no frontmatter at all", "---\nnever closed\n", "---\n---\n", "---\nname: a\n---", "\u0000\u0001\u0002", "x".repeat(200_000), "---\ndescription: " + "y".repeat(10_000) + "\n---\n"];
  for (const text of cases) {
    let s;
    assert.doesNotThrow(() => { s = parseSkill("demo", text); }, JSON.stringify(text.slice(0, 20)));
    assert.equal((s as unknown as { name: string }).name, "demo");
    assert.equal((s as unknown as { tier: string }).tier, "T2");
    assert.ok((s as unknown as { description: string }).description.length <= 400);
  }
  assert.match(parseSkill("demo", "no frontmatter").problem ?? "", /no frontmatter/);
  assert.match(parseSkill("demo", GOOD.replace("name: demo", "name: other")).problem ?? "", /does not match the folder/);
});

test("listSkills: lists real skills, skips odd folders, links and files that are not skills", () => {
  const vault = makeVault();
  const w = (rel: string, text: string): void => { mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true }); writeFileSync(path.join(vault, rel), text); };
  w("skills/demo/SKILL.md", GOOD);
  w("skills/zeta/SKILL.md", GOOD.replace("name: demo", "name: zeta"));
  w("skills/broken/SKILL.md", "garbage with no structure");
  w("skills/huge/SKILL.md", "x".repeat(MAX_SKILL_BYTES + 1));
  w("skills/empty-folder/notes.txt", "no SKILL.md here");
  w("skills/Bad_Name/SKILL.md", GOOD);
  w("skills/.hidden/SKILL.md", GOOD);
  w("skills/README.md", "# skills");
  w("outside/SKILL.md", GOOD.replace("name: demo", "name: linked"));
  symlinkSync(path.join(vault, "outside"), path.join(vault, "skills/linked"));
  mkdirSync(path.join(vault, "skills/asfile"), { recursive: true });
  symlinkSync(path.join(vault, "outside/SKILL.md"), path.join(vault, "skills/asfile/SKILL.md"));
  const list = listSkills(pathsFor(path.join(vault, "os")));
  assert.deepEqual(list.map((s) => s.name), ["asfile", "broken", "demo", "huge", "zeta"]);
  const by = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.equal(by["demo"]?.runnable, true);                                   // control
  assert.equal(by["broken"]?.runnable, true);                                 // odd content still runs, with defaults
  assert.equal(by["broken"]?.tierKnown, false);
  assert.equal(by["huge"]?.runnable, false);                                  // too large: cannot run
  assert.match(by["huge"]?.problem ?? "", /too large/);
  assert.equal(by["asfile"]?.runnable, false);                                // SKILL.md that is a link is not followed
  assert.equal(findSkill(pathsFor(path.join(vault, "os")), "demo")?.name, "demo");
  for (const bad of ["Bad_Name", ".hidden", "../x", "linked", "nope", "x".repeat(41)]) assert.equal(findSkill(pathsFor(path.join(vault, "os")), bad), null, bad);
});

test("a vault with no skills folder lists nothing", () => {
  assert.deepEqual(listSkills(pathsFor(path.join(makeVault(), "os"))), []);
});

test("the real skills in this vault: the seven department agents and the earlier drafts parse as authored", () => {
  const list = listSkills(pathsFor(realOs));
  const by = Object.fromEntries(list.map((s) => [s.name, s]));
  const agents = ["code-quality", "security-review", "knowledge-improvement", "game-testing", "industrial-training-sim", "project-intelligence", "creative-critic"];
  for (const name of agents) {
    const s = by[name];
    assert.ok(s, `${name} is listed`);
    assert.ok(s.tierKnown && s.budgetKnown, `${name} has a readable tier and budget`);
    assert.ok(s.description.length > 20, `${name} has a description`);
    assert.equal(s.problem, null, `${name}: ${s.problem}`);
  }
  for (const name of agents.filter((n) => n !== "industrial-training-sim")) assert.deepEqual([by[name]?.tier, by[name]?.budgetUsd], ["T2", 0.25], name);
  assert.deepEqual([by["industrial-training-sim"]?.tier, by["industrial-training-sim"]?.budgetUsd], ["T3", 1]);
  assert.deepEqual([by["content-cascade"]?.tier, by["content-cascade"]?.budgetUsd], ["T3", 1]);
  assert.deepEqual([by["plan-today"]?.tier, by["plan-today"]?.budgetUsd], ["T2", 0.25]);
  // The oldest draft has no tier or budget line: unknown, defaults, still listed
  assert.deepEqual([by["weekly-review"]?.tierKnown, by["weekly-review"]?.budgetKnown, by["weekly-review"]?.tier, by["weekly-review"]?.budgetUsd], [false, false, "T2", 0.05]);
});

test("policy: each department agent has its own entry, default tools only, no Bash, default script tools", () => {
  const policy = loadPolicy(pathsFor(realOs));
  for (const name of ["code-quality", "security-review", "knowledge-improvement", "game-testing", "industrial-training-sim", "project-intelligence", "creative-critic"]) {
    const entry = policy.skills[name];
    assert.ok(entry, `${name} has a policy entry`);
    assert.deepEqual(entry.tools, [], `${name} adds no tools`);
    assert.equal(entry.scriptTools, undefined, `${name} keeps the default script tools`);
    assert.ok(!t3Tools(policy, name).includes("Bash"), `${name} gets no Bash`);
    assert.deepEqual(t3Tools(policy, name), policy.defaultTools, name);
    assert.deepEqual(scriptToolsFor(policy, name), ["today"], name);
  }
  assert.equal(JSON.stringify(policy).includes("Bash"), false, "the real policy grants Bash to nothing");
});
