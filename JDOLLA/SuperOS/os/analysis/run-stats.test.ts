import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BAD_LINES, NOW, fixtureLog, result } from "./fixture.ts";
import { formatReport } from "./format.ts";
import { parseArgs } from "./cli.ts";
import { MIN_CAP_HITS, computeStats, parseLog, plain, raisedBudget, readLogFile, statsFromLogDir, suggestChanges } from "./run-stats.ts";

const LIMITS = { routineMaxBudgetUsd: 1, dailyCapUsd: 2, t2CapUsd: 0.05 };
const stats30 = () => computeStats(parseLog(fixtureLog()), NOW, 30);

test("parseLog: every kind of bad line is counted and skipped, never thrown, and good lines around them still count", () => {
  const good = result({ days: 1, cost: 0.02 });
  const p = parseLog([good, ...BAD_LINES, good].join("\n"));
  assert.equal(p.results.length, 2, "control: both good lines read");
  assert.equal(p.malformed, BAD_LINES.filter((l) => l.trim() !== "").length, "each non-empty bad line counted once");
  assert.equal(parseLog("").lines, 0);
  assert.doesNotThrow(() => parseLog("\u0000\u0001{{{\n}}}\n\"str\"\n123"));
});

test("computeStats: spend, rates and cap hits are the worked-out numbers for the fixture", () => {
  const s = stats30();
  assert.ok(s.malformed >= 3, "the bad lines are reported");
  assert.equal(s.truncated, false);
  // plan-today: 4*0.3 + 0.1 + 0.2 + 0.2 = 1.7 over 7 runs
  const pt = s.bySkill.find((x) => x.name === "plan-today")!;
  assert.deepEqual([pt.runs, pt.costUsd, pt.done, pt.failed, pt.capHits, pt.lastCapUsd], [7, 1.7, 2, 1, 4, 0.3]);
  assert.equal(pt.failureRate, 0.1429, "1 failure of 7 finished; budget-cap stops are counted under capHits, not here");
  const vc = s.bySkill.find((x) => x.name === "vault-cleanup")!;
  assert.deepEqual([vc.runs, vc.failed, vc.done, vc.blockedRuns, vc.blockedCalls, vc.failureRate], [5, 3, 2, 3, 9, 0.6]);
  assert.deepEqual(s.byRoutine.map((r) => r.name), ["plan-today"]);
  assert.equal(s.byTier.T3.runs, 13);
  assert.equal(s.byTier.T2.runs, 3, "what is today, never mind, and the diagnosis");
  assert.equal(s.byPurpose.diagnosis.runs, 1);
  assert.equal(s.typed.runs, 3);
  assert.equal(s.typed.stopped, 1);
  assert.equal(s.caps.dailyRoutineCapHits, 3, "the 40-day-old skip is outside the window");
  assert.equal(s.caps.diagnosisCapHits, 1);
  assert.equal(s.caps.runCapHits, 4);
  assert.deepEqual(s.blocked, { runs: 3, calls: 9 });
  assert.ok(!JSON.stringify(s).includes("ancient"), "a run older than the window is not counted");
  assert.ok(s.totals.costUsd < 5, "the 9-dollar ancient run is excluded");
});

test("window: --days narrows by the timestamp in the log, and an empty window says so", () => {
  const log = parseLog(fixtureLog());
  const week = computeStats(log, NOW, 7);
  assert.ok(week.totals.runs < stats30().totals.runs);
  assert.ok(computeStats(log, NOW, 365).totals.costUsd > 9, "control: 365 days includes the old run");
  const none = computeStats(log, new Date("2020-01-01T00:00:00Z"), 30);
  assert.equal(none.empty, true);
  assert.equal(none.totals.failureRate, null, "no runs means no rate, not 0 or NaN");
});

test("most expensive requests: top 5 by cost, request cut to 80 characters with markup and control characters removed", () => {
  const s = stats30();
  assert.ok(s.expensive.length <= 5);
  assert.deepEqual(s.expensive.map((e) => e.costUsd), [...s.expensive.map((e) => e.costUsd)].sort((a, b) => b - a));
  const typed = s.expensive.find((e) => e.costUsd === 0.55)!;
  assert.ok(typed.what.length <= 80);
  assert.ok(typed.what.startsWith("Summarise the whole vault"), typed.what);
  assert.ok(!/[<>\n\[\]]/.test(typed.what), typed.what);
  assert.equal(plain("a".repeat(500)).length, 80);
  const long = parseLog(result({ days: 1, cost: 0.04, request: "z".repeat(300) }));
  assert.equal(computeStats(long, NOW, 30).expensive[0]!.what.length, 80);
});

test("readLogFile: missing is empty, a symlinked router.jsonl is refused, a folder is refused", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "an-"));
  assert.deepEqual([readLogFile(dir).missing, readLogFile(dir).problem], [true, null]);
  assert.equal(readLogFile("").problem, "no log folder");
  const real = path.join(dir, "elsewhere.jsonl");
  writeFileSync(real, fixtureLog());
  symlinkSync(real, path.join(dir, "router.jsonl"));
  const r = readLogFile(dir);
  assert.equal(r.text, "");
  assert.ok(r.problem);
  const d2 = mkdtempSync(path.join(tmpdir(), "an-"));
  mkdirSync(path.join(d2, "router.jsonl"));
  assert.ok(readLogFile(d2).problem);
  const d3 = mkdtempSync(path.join(tmpdir(), "an-"));
  writeFileSync(path.join(d3, "router.jsonl"), fixtureLog());
  assert.ok(readLogFile(d3).text.length > 100, "control: a normal file is read");
  assert.equal(statsFromLogDir(d3, NOW, 30).bySkill.length, 2);
});

test("suggestChanges: the plan-today budget example, the 40% failure rate, daily cap and blocked rules; thresholds hold", () => {
  const g = suggestChanges(stats30(), LIMITS);
  const budget = g.find((x) => x.key === "budget|skill:plan-today")!;
  assert.match(budget.observation, /plan-today hit its budget cap 4 times in 30 days/);
  assert.match(budget.fix, /Raise plan-today's budget to \$0\.45/);
  assert.equal(raisedBudget(0.3), 0.45);
  const fail = g.find((x) => x.key === "failure-rate|skill:vault-cleanup")!;
  assert.match(fail.observation, /fails 60% of the time \(3 of 5 runs/);
  assert.ok(g.some((x) => x.kind === "daily-cap"));
  assert.ok(g.some((x) => x.key === "blocked|skill:vault-cleanup"));
  assert.ok(g.every((x) => x.fix.length > 0 && x.observation.length > 0));
  // thresholds: control with just under the limits
  const few = parseLog([result({ days: 1, skill: "s", status: "failed", capHit: true, cap: 0.1 }), result({ days: 1, skill: "s", status: "failed", capHit: true, cap: 0.1 })].join("\n"));
  assert.equal(MIN_CAP_HITS, 3);
  assert.deepEqual(suggestChanges(computeStats(few, NOW, 30), LIMITS), [], "2 cap hits is not enough");
  const small = parseLog([1, 2, 3, 4].map((d) => result({ days: d, skill: "s", status: "failed" })).join("\n"));
  assert.deepEqual(suggestChanges(computeStats(small, NOW, 30), LIMITS), [], "4 runs is too few to call a failure rate");
});

test("suggestChanges: a raise past the per-run limit is not suggested as a plain raise", () => {
  const log = parseLog([1, 2, 3].map((d) => result({ days: d, skill: "big", status: "failed", capHit: true, cap: 0.9 })).join("\n"));
  const [g] = suggestChanges(computeStats(log, NOW, 30), LIMITS);
  assert.ok(g);
  assert.doesNotMatch(g.fix, /^Raise big's budget/);
  assert.match(g.fix, /per-run limit/);
});

test("formatReport and parseArgs", () => {
  const text = formatReport(stats30(), suggestChanges(stats30(), LIMITS));
  for (const must of ["Spend per tier", "Spend per skill", "Spend per routine", "Most expensive requests", "Blocked tool calls: 9", "Caps hit:", "plan-today", "you edit the config yourself"]) assert.ok(text.includes(must), must);
  assert.ok(formatReport(computeStats(parseLog(""), NOW, 30)).includes("No runs were logged"));
  assert.deepEqual(parseArgs([]), { days: 30 });
  assert.deepEqual(parseArgs(["--days", "7"]), { days: 7 });
  assert.deepEqual(parseArgs(["--days=365"]), { days: 365 });
  for (const bad of [["--days", "0"], ["--days", "366"], ["--days", "x"], ["--days"], ["--days", "1.5"], ["--days", "-3"], ["--wat"], ["30"]]) assert.ok("error" in parseArgs(bad), bad.join(" "));
});

test("the CLI runs: exit 0 with a report, exit 2 on a bad option", () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");
  const ok = spawnSync(process.execPath, [cli, "--days", "7"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Run analysis: the last 7 days/);
  const bad = spawnSync(process.execPath, [cli, "--days", "0"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
