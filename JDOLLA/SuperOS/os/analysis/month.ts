// Monthly cost report (Phase 10e): what a calendar month cost, from router.jsonl and the two ledgers in the log folder.
// Read-only. Costs and counts only: no prompt, no request text, no file name ever appears in it. The month is read in Jay's
// time zone (it starts and ends at his local midnight, so a run at 23:30 on the 31st is that month's, not the next).
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { localToInstant } from "../bridge/scheduler.ts";
import { dateIn } from "../sources/file-source.ts";
import type { Named, ParsedLog } from "./run-stats.ts";
import { computeStats, parseLog, readLogFile } from "./run-stats.ts";

const DAY_MS = 86_400_000;
export const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The calendar month containing `now`, as YYYY-MM in time zone `tz`. */
export const currentMonth = (now: Date, tz: string): string => dateIn(now.getTime(), tz).slice(0, 7);
/** The month before `month`. */
export function previousMonth(month: string): string {
  const m = MONTH.exec(month);
  if (!m) throw new RangeError("not a month");
  const y = Number(m[1]), mo = Number(m[2]);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

/** Local midnight at the start of `month` and at the start of the next one (a half-open range), and the days in it. */
export function monthBounds(month: string, tz: string): { fromMs: number; toMs: number; days: number } {
  const m = MONTH.exec(month);
  if (!m) throw new RangeError("not a month");
  const y = Number(m[1]), mo = Number(m[2]);
  const ny = mo === 12 ? y + 1 : y, nmo = mo === 12 ? 1 : mo + 1;
  return { fromMs: localToInstant(y, mo, 1, 0, 0, tz), toMs: localToInstant(ny, nmo, 1, 0, 0, tz), days: new Date(Date.UTC(y, mo, 0)).getUTCDate() };
}

const Ledger = z.object({ spend: z.record(z.string(), z.unknown()).default({}) }).passthrough();
/** Per-day spend from a ledger file (routine-ledger.json or learning-ledger.json): YYYY-MM-DD -> dollars. Never throws. */
export function readLedgerSpend(logDir: string, name: "routine-ledger.json" | "learning-ledger.json"): Record<string, number> | null {
  if (!logDir) return null;
  const file = path.join(logDir, name);
  let text: string;
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 5 * 1024 * 1024) return null;
    const fd = openSync(file, "r");
    try { const buf = Buffer.alloc(fstatSync(fd).size); readSync(fd, buf, 0, buf.length, 0); text = buf.toString("utf8"); } finally { closeSync(fd); }
  } catch { return null; }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const l = Ledger.safeParse(raw);
  if (!l.success) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(l.data.spend)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 10_000) out[k] = v;
  return out;
}

export type MonthStats = {
  month: string; from: string; to: string; days: number;
  /** Whole days of the month that have started, as of now (the full month once it is over). */
  elapsedDays: number; complete: boolean;
  lines: number; malformed: number; empty: boolean;
  totals: { runs: number; costUsd: number; done: number; failed: number; stopped: number; capHits: number };
  byTier: Array<{ name: "T2" | "T3"; runs: number; costUsd: number }>;
  byRoutine: Array<{ name: string; runs: number; costUsd: number }>;
  bySkill: Array<{ name: string; runs: number; costUsd: number }>;
  /** Learning-loop diagnosis runs: their cost from the run log, and from the learning ledger when there is one. */
  diagnosis: { runs: number; costUsd: number; ledgerUsd: number | null; dailyCapUsd: number };
  /** Spend against the daily routine cap (the routine ledger's per-day total: routines and skill runs together). */
  cap: { dailyCapUsd: number; highestDay: { date: string; usd: number; pct: number } | null; daysHit: number; ledgerFound: boolean };
  /** At the current pace (spend so far divided by days so far, times days in the month); the actual total once the month is over. */
  projection: { basis: "actual" | "pace" | "none"; usd: number | null; perDayUsd: number | null };
};

export type MonthCaps = { routineDailyCapUsd: number; learningDailyCapUsd: number };

const slim = (xs: Named[]) => xs.map((x) => ({ name: x.name, runs: x.runs, costUsd: x.costUsd }));

/** Pure: the numbers for one month. */
export function computeMonth(log: ParsedLog, ledgers: { routine: Record<string, number> | null; learning: Record<string, number> | null }, month: string, tz: string, now: Date, caps: MonthCaps): MonthStats {
  const { fromMs, toMs, days } = monthBounds(month, tz);
  const s = computeStats(log, now, days, false, { fromMs, toMs });
  const nowMs = now.getTime();
  const complete = nowMs >= toMs;
  const elapsedDays = nowMs < fromMs ? 0 : complete ? days : Number(dateIn(nowMs, tz).slice(8, 10));
  const inMonth = (day: string) => day.startsWith(month);
  const rLedger = ledgers.routine ? Object.entries(ledgers.routine).filter(([d]) => inMonth(d)) : [];
  let highest: MonthStats["cap"]["highestDay"] = null;
  for (const [date, usd] of rLedger) if (!highest || usd > highest.usd || (usd === highest.usd && date < highest.date)) highest = { date, usd: round4(usd), pct: caps.routineDailyCapUsd > 0 ? Math.round((usd / caps.routineDailyCapUsd) * 1000) / 10 : 0 };
  // A day counts as "hit" when the ledger shows the cap used up, or the bridge refused a run for the cap that day.
  const hit = new Set<string>();
  for (const [date, usd] of rLedger) if (usd >= caps.routineDailyCapUsd - 1e-9) hit.add(date);
  for (const sk of log.dailyCapSkips) if (sk.ms >= fromMs && sk.ms < toMs) hit.add(dateIn(sk.ms, tz));
  const lLedger = ledgers.learning ? Object.entries(ledgers.learning).filter(([d]) => inMonth(d)).reduce((a, [, v]) => a + v, 0) : null;
  const perDay = elapsedDays > 0 ? s.totals.costUsd / elapsedDays : null;
  const projection: MonthStats["projection"] = nowMs < fromMs || elapsedDays === 0 ? { basis: "none", usd: null, perDayUsd: null }
    : complete ? { basis: "actual", usd: s.totals.costUsd, perDayUsd: round4(s.totals.costUsd / days) }
    : { basis: "pace", usd: round4((perDay as number) * days), perDayUsd: round4(perDay as number) };
  return {
    month, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), days, elapsedDays, complete,
    lines: log.lines, malformed: log.malformed, empty: s.totals.runs === 0,
    totals: { runs: s.totals.runs, costUsd: s.totals.costUsd, done: s.totals.done, failed: s.totals.failed, stopped: s.totals.stopped, capHits: s.totals.capHits },
    byTier: (["T2", "T3"] as const).map((t) => ({ name: t, runs: s.byTier[t].runs, costUsd: s.byTier[t].costUsd })),
    byRoutine: slim(s.byRoutine), bySkill: slim(s.bySkill),
    diagnosis: { runs: s.byPurpose.diagnosis.runs, costUsd: s.byPurpose.diagnosis.costUsd, ledgerUsd: lLedger === null ? null : round4(lLedger), dailyCapUsd: caps.learningDailyCapUsd },
    cap: { dailyCapUsd: caps.routineDailyCapUsd, highestDay: highest, daysHit: hit.size, ledgerFound: ledgers.routine !== null },
    projection,
  };
}

/** Reads the log folder and computes the month. Never throws. */
export function monthFromLogDir(logDir: string, month: string, tz: string, now: Date, caps: MonthCaps): MonthStats & { problem: string | null } {
  const f = readLogFile(logDir);
  const stats = computeMonth(parseLog(f.text), { routine: readLedgerSpend(logDir, "routine-ledger.json"), learning: readLedgerSpend(logDir, "learning-ledger.json") }, month, tz, now, caps);
  return { ...stats, problem: f.problem };
}

/** Just the month's total spend, for the Health strip. 0 when there is no log. */
export function monthSpend(logDir: string, now: Date, tz: string): number {
  const { fromMs, toMs } = monthBounds(currentMonth(now, tz), tz);
  const f = readLogFile(logDir);
  return computeStats(parseLog(f.text), now, 31, false, { fromMs, toMs }).totals.costUsd;
}

const usd = (n: number): string => `$${n.toFixed(4)}`;
const pct = (n: number): string => `${Math.round(n)}%`;

/** The report: Markdown, costs and counts only. */
export function formatMonth(m: MonthStats): string {
  const out: string[] = [];
  out.push(`# Costs for ${m.month}`, "");
  out.push(`Local days ${m.month}-01 to ${m.month}-${String(m.days).padStart(2, "0")} in Jay's time zone. ${m.complete ? "The month is over." : `Day ${m.elapsedDays} of ${m.days}.`} Log lines read: ${m.lines}; unreadable lines skipped: ${m.malformed}.`, "");
  if (m.empty) { out.push("No runs were logged this month.", ""); return out.join("\n"); }
  out.push(`**Total spend ${usd(m.totals.costUsd)}** over ${m.totals.runs} runs (${m.totals.done} done, ${m.totals.failed} failed, ${m.totals.capHits} stopped at their budget cap, ${m.totals.stopped} stopped by Jay).`, "");
  const p = m.projection;
  out.push("## At this pace", p.basis === "actual" ? `The month is over: ${usd(p.usd as number)} in total, ${usd(p.perDayUsd as number)} a day.` : p.basis === "pace" ? `About ${usd(p.usd as number)} for the whole month (${usd(p.perDayUsd as number)} a day over the first ${m.elapsedDays} days). A simple straight-line guess.` : "Too early to say.", "");
  out.push("## By tier", ...m.byTier.map((t) => `- ${t.name}: ${usd(t.costUsd)} over ${t.runs} runs`), "");
  const list = (title: string, xs: Array<{ name: string; runs: number; costUsd: number }>) => out.push(`## ${title}`, ...(xs.length ? xs.map((x) => `- ${x.name}: ${usd(x.costUsd)} over ${x.runs} runs`) : ["- (none)"]), "");
  list("By routine", m.byRoutine);
  list("By skill", m.bySkill);
  out.push("## Learning-loop diagnoses", `- ${m.diagnosis.runs} runs, ${usd(m.diagnosis.costUsd)} in the run log${m.diagnosis.ledgerUsd === null ? "" : `; the learning ledger says ${usd(m.diagnosis.ledgerUsd)}`} (their daily cap is $${m.diagnosis.dailyCapUsd.toFixed(2)}).`, "");
  out.push("## Against the daily routine cap", m.cap.ledgerFound
    ? `- Highest day: ${m.cap.highestDay ? `${m.cap.highestDay.date}, ${usd(m.cap.highestDay.usd)} of $${m.cap.dailyCapUsd.toFixed(2)} (${pct(m.cap.highestDay.pct)})` : "no routine or skill spend recorded"}.`
    : "- No routine ledger was found, so the highest day is unknown.",
    `- Days the cap was hit: ${m.cap.daysHit}.`, "");
  return out.join("\n");
}
