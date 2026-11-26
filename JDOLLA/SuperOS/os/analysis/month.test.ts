// Phase 10e: the monthly cost report. Fixtures with fixed timestamps; Jay's time zone is New York (EDT until Nov 1 2026, EST after).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BAD_LINES } from "./fixture.ts";
import { parseArgs } from "./cli.ts";
import { computeMonth, currentMonth, formatMonth, monthBounds, monthFromLogDir, monthSpend, previousMonth, readLedgerSpend } from "./month.ts";
import { writeMonthReport } from "./month-report.ts";
import { parseLog } from "./run-stats.ts";

const NY = "America/New_York";
const CAPS = { routineDailyCapUsd: 2, learningDailyCapUsd: 0.25 };
const NO_LEDGERS = { routine: null, learning: null };

type R = { at: string; tier?: "T2" | "T3"; status?: string; cost?: number; skill?: string | null; routine?: string | null; purpose?: string; capHit?: boolean; request?: string | null };
const line = (r: R): string => JSON.stringify({ at: r.at, kind: "result", id: `r${Math.random().toString(36).slice(2, 8)}`, tier: r.tier ?? "T2", status: r.status ?? "done", costUsd: r.cost ?? 0.01, capUsd: 0.05, ms: 1, exit: 0, denied: 0, purpose: r.purpose ?? "run", skill: r.skill ?? null, routine: r.routine ?? null, dept: "general", capHit: r.capHit ?? false, request: r.request ?? null });
const skip = (at: string): string => JSON.stringify({ at, kind: "routine-skipped", id: "plan-today", note: "Daily cap reached ($2.00 of $2.00)." });
const log = (...lines: string[]) => parseLog(lines.join("\n") + "\n");

test("month boundaries are Jay's local midnights, half open: DST included, and UTC's idea of the month is not used", () => {
  const nov = monthBounds("2026-11", NY);
  assert.equal(new Date(nov.fromMs).toISOString(), "2026-11-01T04:00:00.000Z", "Nov 1 00:00 EDT");
  assert.equal(new Date(nov.toMs).toISOString(), "2026-12-01T05:00:00.000Z", "Dec 1 00:00 EST (the clocks went back in between)");
  assert.equal(nov.days, 30);
  assert.deepEqual([monthBounds("2026-02", NY).days, monthBounds("2028-02", NY).days, monthBounds("2026-12", NY).days], [28, 29, 31]);
  assert.equal(new Date(monthBounds("2026-12", NY).toMs).toISOString(), "2027-01-01T05:00:00.000Z", "December ends at the next year's January");
  assert.equal(new Date(monthBounds("2026-11", "Asia/Tokyo").fromMs).toISOString(), "2026-10-31T15:00:00.000Z", "another zone, another midnight");
  const l = log(
    line({ at: "2026-11-01T03:59:59Z", cost: 1 }),   // Oct 31 23:59:59 EDT: October
    line({ at: "2026-11-01T04:00:00Z", cost: 2 }),   // Nov 1 00:00:00 EDT: November
    line({ at: "2026-11-01T02:00:00Z", cost: 4 }),   // Oct 31 22:00 EDT, but Nov 1 in UTC: still October
    line({ at: "2026-12-01T04:59:59Z", cost: 8 }),   // Nov 30 23:59:59 EST: November
    line({ at: "2026-12-01T05:00:00Z", cost: 16 }),  // Dec 1 00:00 EST: December
  );
  const now = new Date("2026-12-15T12:00:00Z");
  assert.equal(computeMonth(l, NO_LEDGERS, "2026-11", NY, now, CAPS).totals.costUsd, 10, "Nov: 2 + 8");
  assert.equal(computeMonth(l, NO_LEDGERS, "2026-10", NY, now, CAPS).totals.costUsd, 5, "Oct: 1 + 4");
  assert.equal(computeMonth(l, NO_LEDGERS, "2026-12", NY, now, CAPS).totals.costUsd, 16);
  assert.deepEqual([currentMonth(new Date("2026-12-01T04:59:00Z"), NY), currentMonth(new Date("2026-12-01T05:00:00Z"), NY)], ["2026-11", "2026-12"]);
  assert.deepEqual([previousMonth("2026-01"), previousMonth("2026-11")], ["2025-12", "2026-10"]);
  assert.throws(() => monthBounds("2026-13", NY));
});

test("totals, tiers, routines, skills, diagnosis, the cap and a pace projection from a fixture month", () => {
  const l = log(
    line({ at: "2026-11-02T14:00:00Z", tier: "T3", cost: 0.3, skill: "plan-today", routine: "plan-today", capHit: true, status: "failed" }),
    line({ at: "2026-11-03T14:00:00Z", tier: "T3", cost: 0.2, skill: "plan-today", routine: "plan-today" }),
    line({ at: "2026-11-04T14:00:00Z", tier: "T2", cost: 0.05, skill: "vault-cleanup" }),
    line({ at: "2026-11-04T15:00:00Z", tier: "T2", cost: 0.01, request: "SECRETPROMPT write my private plan" }),
    line({ at: "2026-11-05T15:00:00Z", tier: "T2", cost: 0.04, purpose: "diagnosis" }),
    line({ at: "2026-11-06T15:00:00Z", tier: "T2", cost: 0.02, status: "stopped" }),
    line({ at: "2026-10-30T15:00:00Z", cost: 99 }),
    skip("2026-11-04T16:00:00Z"), skip("2026-11-04T17:00:00Z"), skip("2026-11-05T16:00:00Z"), skip("2026-10-30T16:00:00Z"),
  );
  const ledgers = { routine: { "2026-11-02": 0.4, "2026-11-03": 2, "2026-11-04": 1.5, "2026-10-30": 9 }, learning: { "2026-11-05": 0.04, "2026-10-30": 0.2 } };
  const now = new Date("2026-11-10T16:00:00Z"); // day 10 of 30
  const m = computeMonth(l, ledgers, "2026-11", NY, now, CAPS);
  assert.deepEqual([m.totals.runs, m.totals.costUsd, m.totals.done, m.totals.failed, m.totals.capHits, m.totals.stopped], [6, 0.62, 4, 0, 1, 1]);
  assert.deepEqual(m.byTier, [{ name: "T2", runs: 4, costUsd: 0.12 }, { name: "T3", runs: 2, costUsd: 0.5 }]);
  assert.deepEqual(m.byRoutine, [{ name: "plan-today", runs: 2, costUsd: 0.5 }]);
  assert.deepEqual(m.bySkill.map((s) => [s.name, s.costUsd]), [["plan-today", 0.5], ["vault-cleanup", 0.05]]);
  assert.deepEqual(m.diagnosis, { runs: 1, costUsd: 0.04, ledgerUsd: 0.04, dailyCapUsd: 0.25 });
  assert.deepEqual(m.cap.highestDay, { date: "2026-11-03", usd: 2, pct: 100 });
  assert.equal(m.cap.daysHit, 3, "Nov 3 (ledger at the cap) plus Nov 4 and Nov 5 (the bridge refused a run for the cap); the October refusal is not counted");
  assert.deepEqual([m.elapsedDays, m.complete, m.projection.basis, m.projection.perDayUsd, m.projection.usd], [10, false, "pace", 0.062, 1.86], "0.62 over 10 days, times 30");
  // Nothing about a prompt can reach the report.
  const text = formatMonth(m) + JSON.stringify(m);
  for (const s2 of ["SECRETPROMPT", "private plan", "request"]) assert.ok(!text.includes(s2), `no ${s2}`);
  assert.match(formatMonth(m), /Total spend \$0\.6200\*\* over 6 runs/);
  assert.match(formatMonth(m), /Highest day: 2026-11-03, \$2\.0000 of \$2\.00 \(100%\)/);
  assert.match(formatMonth(m), /Days the cap was hit: 3\./);
  // A finished month projects to its own total; a month that has not started projects nothing.
  const over = computeMonth(l, ledgers, "2026-11", NY, new Date("2026-12-02T12:00:00Z"), CAPS);
  assert.deepEqual([over.complete, over.projection.basis, over.projection.usd, over.elapsedDays], [true, "actual", 0.62, 30]);
  const future = computeMonth(l, ledgers, "2027-01", NY, now, CAPS);
  assert.deepEqual([future.projection.basis, future.projection.usd, future.empty], ["none", null, true]);
});

test("an empty month says so and projects nothing worrying; a missing routine ledger is reported, not invented", () => {
  const m = computeMonth(log(line({ at: "2026-09-10T12:00:00Z" })), NO_LEDGERS, "2026-11", NY, new Date("2026-12-05T12:00:00Z"), CAPS);
  assert.deepEqual([m.empty, m.totals.runs, m.totals.costUsd, m.cap.highestDay, m.cap.daysHit, m.cap.ledgerFound, m.diagnosis.ledgerUsd], [true, 0, 0, null, 0, false, null]);
  assert.match(formatMonth(m), /No runs were logged this month\./);
  const withRuns = computeMonth(log(line({ at: "2026-11-10T12:00:00Z" })), NO_LEDGERS, "2026-11", NY, new Date("2026-12-05T12:00:00Z"), CAPS);
  assert.match(formatMonth(withRuns), /No routine ledger was found, so the highest day is unknown\./);
  const emptyLog = computeMonth(parseLog(""), NO_LEDGERS, "2026-11", NY, new Date("2026-11-05T12:00:00Z"), CAPS);
  assert.deepEqual([emptyLog.empty, emptyLog.lines], [true, 0]);
});

test("malformed, truncated and hostile lines are counted and skipped; the good lines around them still count", () => {
  const good = line({ at: "2026-11-10T12:00:00Z", cost: 0.25 });
  const l = parseLog([good, ...BAD_LINES, line({ at: "not a date" }), '{"at":"2026-11-10T12:00:00Z","kind":"result","costUsd":"free"}', good].join("\n"));
  const m = computeMonth(l, NO_LEDGERS, "2026-11", NY, new Date("2026-11-20T12:00:00Z"), CAPS);
  assert.deepEqual([m.totals.runs, m.totals.costUsd], [2, 0.5]);
  assert.ok(m.malformed >= 5, `malformed: ${m.malformed}`);
});

test("ledger files: junk keys, negative or absurd numbers, a broken file and a linked file are all ignored; a good file reads", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mc-ledger-"));
  assert.equal(readLedgerSpend(dir, "routine-ledger.json"), null, "missing");
  assert.equal(readLedgerSpend("", "routine-ledger.json"), null, "no folder");
  writeFileSync(path.join(dir, "routine-ledger.json"), JSON.stringify({ lastRunAt: {}, spend: { "2026-11-02": 0.5, "2026-11-03": -1, "2026-11-04": "x", "bad-key": 1, "2026-11-05": 1e9, "2026-11-06": 1.25 } }));
  assert.deepEqual(readLedgerSpend(dir, "routine-ledger.json"), { "2026-11-02": 0.5, "2026-11-06": 1.25 });
  writeFileSync(path.join(dir, "learning-ledger.json"), "{broken");
  assert.equal(readLedgerSpend(dir, "learning-ledger.json"), null);
  const other = mkdtempSync(path.join(tmpdir(), "mc-out-"));
  writeFileSync(path.join(other, "x.json"), JSON.stringify({ spend: { "2026-11-02": 5 } }));
  rmSync(path.join(dir, "learning-ledger.json"));
  symlinkSync(path.join(other, "x.json"), path.join(dir, "learning-ledger.json"));
  assert.equal(readLedgerSpend(dir, "learning-ledger.json"), null, "a linked ledger is not followed");
});

test("monthFromLogDir and monthSpend read the real files; a missing folder is an empty month, never an error", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mc-dir-"));
  writeFileSync(path.join(dir, "router.jsonl"), [line({ at: "2026-11-10T12:00:00Z", cost: 0.4 }), line({ at: "2026-10-10T12:00:00Z", cost: 7 }), "garbage"].join("\n") + "\n");
  writeFileSync(path.join(dir, "routine-ledger.json"), JSON.stringify({ spend: { "2026-11-10": 0.4 } }));
  const m = monthFromLogDir(dir, "2026-11", NY, new Date("2026-11-20T12:00:00Z"), CAPS);
  assert.deepEqual([m.totals.costUsd, m.malformed, m.cap.highestDay?.usd, m.problem], [0.4, 1, 0.4, null]);
  assert.equal(monthSpend(dir, new Date("2026-11-20T12:00:00Z"), NY), 0.4);
  assert.equal(monthSpend(dir, new Date("2026-10-20T12:00:00Z"), NY), 7, "October's own month");
  const none = monthFromLogDir(path.join(dir, "missing"), "2026-11", NY, new Date("2026-11-20T12:00:00Z"), CAPS);
  assert.deepEqual([none.empty, none.problem], [true, null]);
  assert.equal(monthSpend("", new Date(), NY), 0);
});

test("--month: this month, a named month, either spelling; bad months, mixing with --days and unknown options are refused; --days still works", () => {
  assert.deepEqual(parseArgs(["--month"]), { month: null });
  assert.deepEqual(parseArgs(["--month", "2026-11"]), { month: "2026-11" });
  assert.deepEqual(parseArgs(["--month=2026-02"]), { month: "2026-02" });
  assert.deepEqual(parseArgs(["--month", "--"]) , { error: "Unknown option: --. Usage: npm run analyse:runs -- [--days 30 | --month [YYYY-MM]]" });
  for (const bad of [["--month", "2026-13"], ["--month", "2026-00"], ["--month", "26-11"], ["--month", "november"], ["--month=2026-1"], ["--month", "2026-11", "--days", "7"], ["--days", "7", "--month"], ["--month", "2026-11-01"]]) assert.ok("error" in parseArgs(bad), bad.join(" "));
  assert.deepEqual(parseArgs([]), { days: 30 });
  assert.deepEqual(parseArgs(["--days", "7"]), { days: 7 });
  assert.ok("error" in parseArgs(["--days", "0"]));
});

test("the CLI: a month with no runs prints the plain line and exits 0; a bad month exits 2", () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");
  const ok = spawnSync(process.execPath, [cli, "--month", "2001-01"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /# Costs for 2001-01/);
  assert.match(ok.stdout, /No runs were logged this month\./);
  assert.equal(spawnSync(process.execPath, [cli, "--month", "2001-13"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, "--month"], { encoding: "utf8" }).status, 0, "this month");
});

function reportVault(): { vault: string; logs: string } {
  const vault = mkdtempSync(path.join(tmpdir(), "mc-vault-"));
  const logs = mkdtempSync(path.join(tmpdir(), "mc-logs-"));
  writeFileSync(path.join(logs, "router.jsonl"), [line({ at: "2026-10-10T12:00:00Z", cost: 0.5, routine: "plan-today", skill: "plan-today", request: "SECRETPROMPT" }), line({ at: "2026-09-10T12:00:00Z", cost: 9 })].join("\n") + "\n");
  return { vault, logs };
}
const writeArgs = (v: { vault: string; logs: string }, over: object = {}) => ({ vault: v.vault, logDir: v.logs, timezone: NY, now: new Date("2026-11-01T12:10:00Z"), caps: CAPS, ...over });

test("the report: last month's totals go to reports/YYYY-MM_costs.md; it never overwrites (-v2, -v3); an empty month writes nothing", () => {
  const v = reportVault();
  const first = writeMonthReport(writeArgs(v));
  assert.deepEqual([first.status, first.rel], ["done", "reports/2026-10_costs.md"]);
  const file = path.join(v.vault, "reports", "2026-10_costs.md");
  const text = readFileSync(file, "utf8");
  assert.match(text, /^<!-- Written by the month-costs routine/);
  assert.match(text, /# Costs for 2026-10/);
  assert.match(text, /Total spend \$0\.5000\*\* over 1 runs/);
  assert.ok(!text.includes("SECRETPROMPT") && !text.includes("9.0000"), "no prompt, and September's spend is not in October's report");
  const second = writeMonthReport(writeArgs(v));
  assert.equal(second.rel, "reports/2026-10_costs-v2.md");
  assert.equal(readFileSync(file, "utf8"), text, "the first report is byte for byte what it was");
  assert.equal(writeMonthReport(writeArgs(v)).rel, "reports/2026-10_costs-v3.md");
  assert.deepEqual(readdirSync(path.join(v.vault, "reports")).sort(), ["2026-10_costs-v2.md", "2026-10_costs-v3.md", "2026-10_costs.md"]);
  const empty = writeMonthReport(writeArgs(v, { month: "2026-08" }));
  assert.deepEqual([empty.status, empty.rel, /No runs were logged in 2026-08/.test(empty.message)], ["nothing", null, true]);
  assert.ok(!existsSync(path.join(v.vault, "reports", "2026-08_costs.md")));
  assert.equal(writeMonthReport(writeArgs(v, { month: "2026-9x" })).status, "failed", "a bad month fails plainly");
});

test("the report goes only under the vault's reports/: a reports folder that is a link out is refused and nothing is written outside", () => {
  const v = reportVault();
  const outside = mkdtempSync(path.join(tmpdir(), "mc-outside-"));
  symlinkSync(outside, path.join(v.vault, "reports"));
  const r = writeMonthReport(writeArgs(v));
  assert.equal(r.status, "failed");
  assert.deepEqual(readdirSync(outside), [], "nothing was written through the link");
  const ok = reportVault();
  assert.equal(writeMonthReport(writeArgs(ok)).status, "done", "control: a normal vault works");
});
