import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EvalFile, indexedPaths, keywordRanker, loadEvalFile, MRR_DEPTH, runEval, type Ranker } from "./eval.ts";
import { makeBrainVault } from "./fixture.ts";
import { rebuildIndex } from "./indexer.ts";
import { openReadOnly } from "./search.ts";

const VAULT = path.resolve(import.meta.dirname, "../..");
const QUESTIONS = path.join(VAULT, "evals", "brain", "questions.json");

const file = (qs: { id: string; relevant: string[]; style?: "keyword" | "paraphrase" | "synonym" }[]): EvalFile => ({
  version: 1,
  questions: qs.map((q) => ({ id: q.id, style: q.style ?? "keyword", query: q.id, relevant: q.relevant })),
});
const fake = (answers: Record<string, string[]>): Ranker => (q) => answers[q] ?? [];
const writeTmp = (o: unknown): string => { const f = path.join(mkdtempSync(path.join(tmpdir(), "eval-")), "q.json"); writeFileSync(f, JSON.stringify(o)); return f; };

describe("eval metrics", () => {
  const ef = file([{ id: "a", relevant: ["wiki/a.md"] }, { id: "b", relevant: ["wiki/b.md"] }, { id: "c", relevant: ["wiki/c.md"], style: "synonym" }]);
  const rank = fake({ a: ["wiki/a.md", "wiki/x.md"], b: ["wiki/x.md", "wiki/y.md", "wiki/b.md"], c: ["wiki/x.md"] });
  it("hit@k and MRR match a hand count", () => {
    const r1 = runEval(ef, rank, 1);
    assert.equal(r1.hitAtK, 1 / 3);
    assert.equal(runEval(ef, rank, 3).hitAtK, 2 / 3);
    assert.ok(Math.abs(r1.mrr - (1 + 1 / 3) / 3) < 1e-12);
    assert.deepEqual(r1.results.map((r) => r.rank), [1, 3, null]);
    assert.equal(r1.byStyle["synonym"]?.n, 1);
    assert.equal(r1.byStyle["synonym"]?.hitAtK, 0);
  });
  it("repeated chunks of one note count once, so they can't push the right note down", () => {
    const r = runEval(file([{ id: "a", relevant: ["wiki/a.md"] }]), fake({ a: ["wiki/x.md", "wiki/x.md", "wiki/x.md", "wiki/a.md"] }), 1);
    assert.equal(r.results[0]!.rank, 2);
  });
  it("any listed note counts as a hit; a rank past the MRR depth is a miss", () => {
    assert.equal(runEval(file([{ id: "a", relevant: ["wiki/a.md", "raw/a.md"] }]), fake({ a: ["raw/a.md"] }), 1).hitAtK, 1);
    const deep = Array.from({ length: MRR_DEPTH }, (_, i) => `wiki/n${i}.md`).concat("wiki/a.md");
    const r = runEval(file([{ id: "a", relevant: ["wiki/a.md"] }]), fake({ a: deep }), 5);
    assert.equal(r.results[0]!.rank, null);
    assert.equal(r.mrr, 0);
  });
  it("refuses a bad k", () => {
    for (const k of [0, -1, 1.5, MRR_DEPTH + 1]) assert.throws(() => runEval(ef, rank, k));
  });
  it("reports relevant paths that are not in the index", () => {
    const r = runEval(ef, rank, 5, new Set(["wiki/a.md", "wiki/b.md"]));
    assert.deepEqual(r.unknownPaths, ["wiki/c.md"]);
  });
});

describe("eval file validation", () => {
  it("rejects duplicate ids, unknown styles, extra fields and paths outside wiki/ and raw/", () => {
    const good = { version: 1, questions: [{ id: "a", style: "keyword", query: "x", relevant: ["wiki/a.md"] }] };
    assert.doesNotThrow(() => loadEvalFile(writeTmp(good))); // control
    const bad: unknown[] = [
      { ...good, questions: [good.questions[0], good.questions[0]] },
      { ...good, questions: [{ ...good.questions[0], style: "vibes" }] },
      { ...good, questions: [{ ...good.questions[0], extra: 1 }] },
      { ...good, questions: [] },
      ...["../.env", ".env", "os/config/x.md", "wiki/a.json", "logs/run.md"].map((p) => ({ ...good, questions: [{ ...good.questions[0], relevant: [p] }] })),
    ];
    for (const b of bad) assert.throws(() => loadEvalFile(writeTmp(b)), JSON.stringify(b));
  });
});

describe("the real eval set", () => {
  it("is valid, has 25 to 30 questions in all three styles, and every relevant note exists in the vault index", () => {
    const ef = loadEvalFile(QUESTIONS);
    assert.ok(ef.questions.length >= 25 && ef.questions.length <= 30, String(ef.questions.length));
    assert.deepEqual([...new Set(ef.questions.map((q) => q.style))].sort(), ["keyword", "paraphrase", "synonym"]);
    const db = path.join(mkdtempSync(path.join(tmpdir(), "eval-db-")), "i.sqlite");
    rebuildIndex(VAULT, db);
    const h = openReadOnly(db);
    try {
      const report = runEval(ef, keywordRanker(h), 5, indexedPaths(h));
      assert.deepEqual(report.unknownPaths, []);
      assert.ok(report.hitAtK > 0 && report.hitAtK <= 1);
      assert.equal(report.byStyle["keyword"]?.hitAtK, 1, "control: keyword-style questions must be easy for keyword search");
    } finally { h.close(); }
  });
});

describe("eval CLI", () => {
  it("prints hit@k and MRR, and exits 1 when a relevant note is missing from the index", () => {
    const { vault, dir } = makeBrainVault();
    const db = path.join(dir, "i.sqlite");
    rebuildIndex(vault, db);
    const run = (q: unknown, k = "3") => spawnSync(process.execPath, [path.join(import.meta.dirname, "cli.ts"), "eval", "--k", k, "--questions", writeTmp(q), "--db", db, "--vault", vault], { encoding: "utf8" });
    const ok = run({ version: 1, questions: [{ id: "a", style: "keyword", query: "servo alarm 42", relevant: ["wiki/industrial/servo.md"] }] });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /keyword: 1 questions, hit@3 1\.000, MRR 1\.000/);
    const missing = run({ version: 1, questions: [{ id: "a", style: "keyword", query: "servo", relevant: ["wiki/industrial/nope.md"] }] });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /WARNING: 1 relevant paths are not in the index/);
  });
});
