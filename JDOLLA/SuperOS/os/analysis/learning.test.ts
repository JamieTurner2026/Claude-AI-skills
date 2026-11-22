import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { formatLearning, learningStats } from "./learning.ts";
import { parseLearningArgs } from "./learning-cli.ts";
import { makeToolVault, put } from "../tools/vault-fixture.ts";

const NOW = new Date("2026-11-22T12:00:00Z");
type P = { id: string; createdAt: string; status: "pending" | "approved" | "rejected"; decidedAt?: string; kind: string; skill?: string | null; rule?: string };
const proposal = (p: P) => JSON.stringify({
  id: p.id, createdAt: p.createdAt, status: p.status, decidedAt: p.decidedAt ?? null, kind: p.kind,
  run: { id: "r", tier: "T2", dept: "ai", skill: p.skill ?? null, routine: null, status: "failed", error: "LEARNSECRET error", denied: [], costUsd: 0, capUsd: 0.25, prompt: "LEARNSECRET prompt" },
  whatBroke: "LEARNSECRET broke", diagnosis: { status: "done", note: "LEARNSECRET", runId: null, costUsd: 0 }, fix: "LEARNSECRET", learning: "LEARNSECRET",
  skillChange: p.rule ? { skill: p.skill, rule: p.rule } : null, applied: null, move: null,
});

function setup() {
  const t = makeToolVault();
  const ps: P[] = [
    { id: "a", kind: "failed", skill: "plan-today", createdAt: "2026-11-01T12:00:00Z", status: "approved", decidedAt: "2026-11-02T12:00:00Z", rule: "LEARNSECRET rule one" }, // 1 day
    { id: "b", kind: "failed", skill: "plan-today", createdAt: "2026-11-10T12:00:00Z", status: "rejected", decidedAt: "2026-11-13T12:00:00Z" },                          // 3 days
    { id: "c", kind: "failed", skill: "vault-cleanup", createdAt: "2026-11-20T12:00:00Z", status: "pending" },
    { id: "d", kind: "budget", skill: "vault-cleanup", createdAt: "2026-11-15T12:00:00Z", status: "approved", decidedAt: "2026-11-15T18:00:00Z", rule: "x" },              // 0.25 days
    { id: "e", kind: "move", createdAt: "2026-11-21T12:00:00Z", status: "approved", decidedAt: "2026-11-21T13:00:00Z" },
    { id: "f", kind: "tune", createdAt: "2026-08-01T12:00:00Z", status: "rejected", decidedAt: "2026-08-11T12:00:00Z" },                                                // 10 days, old
  ];
  for (const p of ps) put(t.vault, `proposals/${p.id}.json`, proposal(p));
  put(t.vault, "proposals/broken.json", "{nope");
  put(t.vault, "skills/plan-today/SKILL.md", "# Plan today\n\n## Steps\n- not a rule\n\n## Learned rules\n- LEARNSECRET one (approved 2026-11-02)\n- two\n\n- three\n");
  put(t.vault, "skills/vault-cleanup/SKILL.md", "# Vault cleanup\n## Learned rules\n- one\n## Later section\n- not a rule\n");
  put(t.vault, "skills/morning-intel/SKILL.md", "# Morning intel\nNo learned rules yet.\n");
  put(t.vault, "skills/README.md", "## Learned rules\n- not a skill file\n");
  put(t.outside, "SKILL.md", "## Learned rules\n- a\n- b\n- c\n- d\n- e\n");
  mkdirSync(path.join(t.vault, "skills", "linked-skill"), { recursive: true });
  symlinkSync(path.join(t.outside, "SKILL.md"), path.join(t.vault, "skills", "linked-skill", "SKILL.md")); // a link at a real SKILL.md path
  return t;
}

test("all proposals: per kind made, approved, rejected, pending and the median days to a decision", () => {
  const { vault } = setup();
  const s = learningStats(vault, NOW, null);
  const byKind = Object.fromEntries(s.byKind.map((r) => [r.kind, r]));
  assert.deepEqual(byKind["failed"], { kind: "failed", made: 3, approved: 1, rejected: 1, pending: 1, medianDaysToDecision: 2 });
  assert.deepEqual(byKind["budget"], { kind: "budget", made: 1, approved: 1, rejected: 0, pending: 0, medianDaysToDecision: 0.3 });
  assert.deepEqual(byKind["tune"], { kind: "tune", made: 1, approved: 0, rejected: 1, pending: 0, medianDaysToDecision: 10 });
  assert.equal(byKind["uncited"], undefined, "kinds with no proposals are left out");
  assert.deepEqual({ ...s.total, kind: "all" }, { kind: "all", made: 6, approved: 3, rejected: 2, pending: 1, medianDaysToDecision: 1 });
  assert.equal(s.skipped, 1);
});

test("--days limits to proposals created in the window", () => {
  const { vault } = setup();
  const s = learningStats(vault, NOW, 30);
  assert.equal(s.total.made, 5, "the August tune is outside 30 days");
  assert.equal(s.byKind.find((r) => r.kind === "tune"), undefined);
  assert.deepEqual([s.from, s.to], ["2026-10-23", "2026-11-22"]);
});

test("learned rules are counted from each SKILL.md's section only; links and non-skill files are ignored", () => {
  const { vault } = setup();
  const s = learningStats(vault, NOW, null);
  assert.deepEqual(s.learnedRules, [{ skill: "plan-today", rules: 3 }, { skill: "vault-cleanup", rules: 1 }]);
  assert.deepEqual(s.approvedRuleProposals, [{ skill: "plan-today", approved: 1 }, { skill: "vault-cleanup", approved: 1 }]);
});

test("counts and skill names only: no proposal or rule text comes out", () => {
  const { vault } = setup();
  const s = learningStats(vault, NOW, null);
  for (const out of [JSON.stringify(s), formatLearning(s)]) assert.ok(!out.includes("LEARNSECRET"), out.slice(0, 200));
  const text = formatLearning(s);
  assert.match(text, /failed\s+3\s+1\s+1\s+1\s+2 d/);
  assert.match(text, /plan-today\s+3/);
});

test("an empty vault is a zero scorecard, not an error", () => {
  const { vault } = makeToolVault();
  const s = learningStats(vault, NOW, 7);
  assert.equal(s.total.made, 0);
  assert.match(formatLearning(s), /No proposals in this window/);
});

test("arguments: --days 1..365 and --json only", () => {
  assert.deepEqual(parseLearningArgs([]), { days: null, json: false });
  assert.deepEqual(parseLearningArgs(["--days", "30", "--json"]), { days: 30, json: true });
  assert.deepEqual(parseLearningArgs(["--days=7"]), { days: 7, json: false });
  for (const bad of [["--days"], ["--days", "0"], ["--days", "366"], ["--days", "1.5"], ["--days", "-3"], ["--vault", "/etc"], ["learning"]]) assert.ok("error" in parseLearningArgs(bad), JSON.stringify(bad));
});

test("the CLI prints the scorecard for a vault and writes nothing", () => {
  const { vault } = setup();
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "learning-cli.ts"), "--days", "30"], { encoding: "utf8", env: { ...process.env, SUPEROS_VAULT: vault } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Learning-loop scorecard: proposals from the last 30 days/);
  assert.equal(spawnSync(process.execPath, [path.join(import.meta.dirname, "learning-cli.ts"), "--days", "x"], { encoding: "utf8" }).status, 2);
});
