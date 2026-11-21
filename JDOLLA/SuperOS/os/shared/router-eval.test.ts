import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalSetError, loadEvalSet, scoreSet, type EvalRequest } from "./router-eval.ts";
import { main } from "./router-eval-cli.ts";
import { route } from "./router.ts";
import type { RouteContext, RouteResult, Tier } from "./types.ts";

const OS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const good = { id: "a", text: "open software", tier: "T1" };

function problems(raw: unknown): string[] {
  try { loadEvalSet(raw); } catch (e) { if (e instanceof EvalSetError) return e.problems; throw e; }
  return [];
}

test("loader accepts a valid set (control)", () => {
  assert.deepEqual(problems({ requests: [good, { id: "b", text: "what is a servo?", tier: "T2", dept: "industrial", note: "n", tags: ["ambiguous"] }] }), []);
  assert.equal(loadEvalSet([good]).length, 1);
});

test("loader rejects unknown tier, duplicate id, empty text", () => {
  assert.match(problems([good, { id: "b", text: "x", tier: "T4" }]).join(), /unknown tier/);
  assert.match(problems([good, { ...good }]).join(), /duplicate id/);
  assert.match(problems([{ id: "b", text: "   ", tier: "T2" }]).join(), /text is empty/);
  assert.match(problems([{ id: "b", tier: "T2" }]).join(), /text is empty/);
});

test("loader rejects other malformed shapes", () => {
  assert.match(problems({}).join(), /expected an array/);
  assert.match(problems([]).join(), /no requests/);
  assert.match(problems([{ ...good, dept: "sales" }]).join(), /unknown dept/);
  assert.match(problems([{ ...good, tags: ["easy"] }]).join(), /tags/);
  assert.match(problems([{ ...good, expected: "T1" }]).join(), /unknown field/);
  assert.match(problems([{ ...good, id: "Bad Id" }]).join(), /slug/);
  assert.match(problems([{ ...good, text: "a".repeat(501) }]).join(), /over 500/);
  assert.match(problems(["nope"]).join(), /not an object/);
  // Every problem is reported at once, not just the first.
  assert.equal(problems([{ id: "x", text: "", tier: "T9" }, { id: "x", text: "ok", tier: "T1" }]).length, 3);
});

test("scorer is exact on a tiny hand-made set", () => {
  // Fake router: picks the tier written in the text, so every outcome is known in advance.
  const fake = (text: string): RouteResult => {
    const tier = (/T[123]/.exec(text)?.[0] ?? "T2") as Tier;
    return { tier, probs: { T1: tier === "T1" ? 1 : 0, T2: tier === "T2" ? 1 : 0, T3: tier === "T3" ? 1 : 0 }, reason: "fake" };
  };
  const set: EvalRequest[] = [
    { id: "1", text: "T1", tier: "T1" },
    { id: "2", text: "T2", tier: "T2" },
    { id: "3", text: "T3", tier: "T3" },
    { id: "4", text: "T2", tier: "T3", note: "under to T2" },
    { id: "5", text: "T1", tier: "T3" },
    { id: "6", text: "T3", tier: "T2" },
  ];
  const s = scoreSet(set, { depts: [] }, fake);
  assert.equal(s.total, 6);
  assert.equal(s.correct, 3);
  assert.equal(s.accuracy, 0.5);
  assert.deepEqual(s.perTier.T3, { n: 3, correct: 1, accuracy: 1 / 3 });
  assert.deepEqual(s.perTier.T1, { n: 1, correct: 1, accuracy: 1 });
  assert.deepEqual(s.confusion, { T1: { T1: 1, T2: 0, T3: 0 }, T2: { T1: 0, T2: 1, T3: 1 }, T3: { T1: 1, T2: 1, T3: 1 } });
  assert.deepEqual(s.underRouted, { toT2: 1, toT1: 1, total: 2 });
  assert.deepEqual(s.overRouted, { fromT1: 0, fromT2: 1, total: 1 });
  assert.deepEqual(s.misses.map((m) => m.id), ["4", "5", "6"]);
  assert.equal(s.misses[0]?.note, "under to T2");

  // Control: a set the fake router gets fully right scores 100% with no misses.
  const perfect = scoreSet(set.slice(0, 3), { depts: [] }, fake);
  assert.equal(perfect.accuracy, 1);
  assert.equal(perfect.misses.length, 0);
  assert.equal(perfect.underRouted.total + perfect.overRouted.total, 0);
});

test("scorer passes the department context through to the router", () => {
  const ctx: RouteContext = { depts: [{ slug: "gamedev", name: "Game Development & 3D Design" }] };
  const set: EvalRequest[] = [{ id: "g", text: "open gamedev", tier: "T1" }];
  assert.equal(scoreSet(set, ctx, route).correct, 1);
});

test("the real set loads and the command prints the summary, exit 0", () => {
  const lines: string[] = [];
  const code = main([], OS_DIR, (s) => lines.push(s), (s) => lines.push(s));
  assert.equal(code, 0, lines.join("\n"));
  const text = lines.join("\n");
  assert.match(text, /^Router eval: \d+\/\d+ correct/);
  assert.match(text, /Per tier/);
  assert.match(text, /Confusion/);
  assert.match(text, /Under-routed T3/);
  assert.match(text, /Over-routed to T3/);
  const real = loadEvalSet(JSON.parse(readFileSync(path.join(OS_DIR, "..", "evals", "router", "requests.json"), "utf8")));
  assert.ok(real.length >= 50, `only ${real.length} requests`);
  for (const t of ["T1", "T2", "T3"]) assert.ok(real.some((r) => r.tier === t), t);
});

test("--json prints parseable JSON and writes nothing", () => {
  const before = readdirSync(path.join(OS_DIR, "..", "evals", "router")).join();
  const lines: string[] = [];
  assert.equal(main(["--json"], OS_DIR, (s) => lines.push(s)), 0);
  const parsed = JSON.parse(lines.join("\n"));
  assert.equal(typeof parsed.accuracy, "number");
  assert.ok(parsed.departments.includes("gamedev"));
  assert.equal(readdirSync(path.join(OS_DIR, "..", "evals", "router")).join(), before);
});

test("a malformed set file exits 1; a bad argument exits 2", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "router-eval-"));
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ id: "a", text: "hi", tier: "T5" }]));
  const errs: string[] = [];
  assert.equal(main(["--file", bad], OS_DIR, () => {}, (s) => errs.push(s)), 1);
  assert.match(errs.join(), /unknown tier/);
  assert.equal(main(["--write"], OS_DIR, () => {}, () => {}), 2);
});
