// Cost and failure report (Phase 10b): reads router.jsonl and says where the money went and what keeps going wrong.
// Pure and defensive: a log can be half-written, truncated, hand-edited or from an older version, so every line is checked and
// a bad one is counted and skipped, never thrown. Node and zod only, so the CLI and the tools server can both use it.
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const MAX_LOG_BYTES = 20 * 1024 * 1024;
export const MAX_LINE_CHARS = 20_000;
export const REQUEST_CHARS = 80;
const DAY_MS = 86_400_000;
const LIST_CAP = 20;

/** A run's result line (bridge/runs.ts). Older logs lack the newer fields, so they all have defaults. */
const ResultLine = z.object({
  at: z.string().max(40),
  kind: z.literal("result"),
  id: z.string().max(60),
  tier: z.enum(["T2", "T3"]),
  status: z.enum(["done", "failed", "stopped", "running"]),
  costUsd: z.number().finite().min(0).max(10_000).nullable().default(null),
  capUsd: z.number().finite().min(0).max(10_000).nullable().default(null),
  denied: z.number().int().min(0).max(100_000).default(0),
  purpose: z.enum(["run", "diagnosis"]).default("run"),
  skill: z.string().max(60).nullable().default(null),
  routine: z.string().max(60).nullable().default(null),
  capHit: z.boolean().default(false),
  request: z.string().max(400).nullable().default(null),
}).passthrough();
type Result = z.infer<typeof ResultLine>;

const Skipped = z.object({ at: z.string().max(40), kind: z.enum(["routine-skipped", "routine-not-started"]), id: z.string().max(80).default(""), note: z.string().max(500).default("") }).passthrough();
const Proposal = z.object({ at: z.string().max(40), kind: z.literal("proposal"), diagnosis: z.string().max(40).optional() }).passthrough();

export type ParsedLog = { results: Array<Result & { ms: number }>; dailyCapSkips: Array<{ ms: number; id: string }>; diagnosisCapSkips: number[]; lines: number; malformed: number };

/** Reads the text of a router.jsonl into typed events. Never throws; counts what it could not use. */
export function parseLog(text: string): ParsedLog {
  const out: ParsedLog = { results: [], dailyCapSkips: [], diagnosisCapSkips: [], lines: 0, malformed: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    out.lines++;
    if (line.length > MAX_LINE_CHARS) { out.malformed++; continue; }
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { out.malformed++; continue; }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) { out.malformed++; continue; }
    const kind = (raw as { kind?: unknown }).kind;
    if (kind === "result") {
      const r = ResultLine.safeParse(raw);
      const ms = r.success ? Date.parse(r.data.at) : NaN;
      if (!r.success || !Number.isFinite(ms)) { out.malformed++; continue; }
      out.results.push({ ...r.data, ms });
    } else if (kind === "routine-skipped" || kind === "routine-not-started") {
      const s = Skipped.safeParse(raw);
      const ms = s.success ? Date.parse(s.data.at) : NaN;
      if (!s.success || !Number.isFinite(ms)) { out.malformed++; continue; }
      if (/^Daily cap reached/i.test(s.data.note)) out.dailyCapSkips.push({ ms, id: s.data.id });
    } else if (kind === "proposal") {
      const p = Proposal.safeParse(raw);
      const ms = p.success ? Date.parse(p.data.at) : NaN;
      if (!p.success || !Number.isFinite(ms)) { out.malformed++; continue; }
      if (p.data.diagnosis === "skipped-cap") out.diagnosisCapSkips.push(ms);
    } // every other kind (start, route, brain-index ...) is fine and not needed here
  }
  return out;
}

/** The last 20 MB of router.jsonl as text. A missing file is an empty log; a link or a non-file is refused. Never throws. */
export function readLogFile(logDir: string): { text: string; missing: boolean; truncated: boolean; problem: string | null } {
  if (!logDir) return { text: "", missing: true, truncated: false, problem: "no log folder" };
  const file = path.join(logDir, "router.jsonl");
  let st;
  try { st = lstatSync(file); } catch { return { text: "", missing: true, truncated: false, problem: null }; }
  if (!st.isFile() || st.isSymbolicLink()) return { text: "", missing: false, truncated: false, problem: "router.jsonl is not a regular file" };
  try {
    if (realpathSync(file) !== path.join(realpathSync(logDir), "router.jsonl")) return { text: "", missing: false, truncated: false, problem: "router.jsonl leads somewhere else" };
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - MAX_LOG_BYTES);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1); // the first line is cut in half: drop it
      return { text, missing: false, truncated: start > 0, problem: null };
    } finally { closeSync(fd); }
  } catch { return { text: "", missing: false, truncated: false, problem: "router.jsonl could not be read" }; }
}

export type Bucket = {
  runs: number; costUsd: number; done: number; failed: number; stopped: number;
  capHits: number; blockedRuns: number; blockedCalls: number; lastCapUsd: number | null;
  /** failed / (done + failed), not counting stopped runs or runs that hit their cap (those are in capHits). */
  failureRate: number | null;
};
export type Named = Bucket & { name: string };
export type Stats = {
  days: number; from: string; to: string; lines: number; malformed: number; truncated: boolean; empty: boolean;
  totals: Bucket & { stopRate: number | null };
  byTier: Record<"T2" | "T3", Bucket>;
  byPurpose: Record<"run" | "diagnosis", Bucket>;
  bySkill: Named[];
  byRoutine: Named[];
  typed: Bucket;
  expensive: Array<{ costUsd: number; tier: "T2" | "T3"; status: string; what: string }>;
  blocked: { runs: number; calls: number };
  caps: { runCapHits: number; dailyRoutineCapHits: number; diagnosisCapHits: number };
};

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const empty = (): Bucket => ({ runs: 0, costUsd: 0, done: 0, failed: 0, stopped: 0, capHits: 0, blockedRuns: 0, blockedCalls: 0, lastCapUsd: null, failureRate: null });

function add(b: Bucket, r: Result): void {
  b.runs++;
  b.costUsd += r.costUsd ?? 0;
  if (r.status === "done") b.done++;
  else if (r.status === "stopped") b.stopped++;
  else if (r.status === "failed") { if (r.capHit) b.capHits++; else b.failed++; }
  if (r.denied > 0) { b.blockedRuns++; b.blockedCalls += r.denied; }
  if (r.capUsd !== null) b.lastCapUsd = r.capUsd;
}

function finish(b: Bucket): Bucket {
  const finished = b.done + b.failed + b.capHits;
  return { ...b, costUsd: round4(b.costUsd), failureRate: finished > 0 ? round4(b.failed / finished) : null };
}

/** Clean one-line text for display: no control characters, markup or links, cut to 80 characters. */
export function plain(text: string, max = REQUEST_CHARS): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/<[^>]*>/g, " ").replace(/\[\[|\]\]/g, "").replace(/[<>`|]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The numbers for the last `days` days (by the timestamps in the log) as of `now`. */
export function computeStats(log: ParsedLog, now: Date, days: number, truncated = false): Stats {
  const to = now.getTime();
  const from = to - days * DAY_MS;
  const inWindow = (ms: number) => ms >= from && ms <= to;
  const results = log.results.filter((r) => inWindow(r.ms));
  const totals = empty(); const tier = { T2: empty(), T3: empty() }; const purpose = { run: empty(), diagnosis: empty() }; const typed = empty();
  const skills = new Map<string, Bucket>(); const routines = new Map<string, Bucket>();
  for (const r of results) {
    add(totals, r); add(tier[r.tier], r); add(purpose[r.purpose], r);
    if (r.purpose === "run" && !r.skill && !r.routine) add(typed, r);
    if (r.skill) { const b = skills.get(r.skill) ?? empty(); add(b, r); skills.set(r.skill, b); }
    if (r.routine) { const b = routines.get(r.routine) ?? empty(); add(b, r); routines.set(r.routine, b); }
  }
  const named = (m: Map<string, Bucket>): Named[] => [...m].map(([name, b]) => ({ name, ...finish(b) })).sort((a, b) => b.costUsd - a.costUsd || (a.name < b.name ? -1 : 1)).slice(0, LIST_CAP);
  const finished = totals.done + totals.failed + totals.capHits + totals.stopped;
  const t = finish(totals);
  const expensive = results
    .filter((r) => r.costUsd !== null && r.costUsd > 0)
    .sort((a, b) => (b.costUsd as number) - (a.costUsd as number) || a.ms - b.ms)
    .slice(0, 5)
    .map((r) => ({
      costUsd: round4(r.costUsd as number), tier: r.tier, status: r.status,
      what: r.request ? plain(r.request) : r.routine ? `routine ${plain(r.routine, 60)}` : r.skill ? `skill ${plain(r.skill, 60)}` : r.purpose === "diagnosis" ? "(a learning-loop diagnosis)" : "(no request text was logged)",
    }));
  return {
    days, from: new Date(from).toISOString(), to: new Date(to).toISOString(), lines: log.lines, malformed: log.malformed, truncated, empty: results.length === 0,
    totals: { ...t, stopRate: finished > 0 ? round4(totals.stopped / finished) : null },
    byTier: { T2: finish(tier.T2), T3: finish(tier.T3) },
    byPurpose: { run: finish(purpose.run), diagnosis: finish(purpose.diagnosis) },
    bySkill: named(skills), byRoutine: named(routines), typed: finish(typed), expensive,
    blocked: { runs: totals.blockedRuns, calls: totals.blockedCalls },
    caps: {
      runCapHits: totals.capHits,
      dailyRoutineCapHits: log.dailyCapSkips.filter((s) => inWindow(s.ms)).length,
      diagnosisCapHits: log.diagnosisCapSkips.filter(inWindow).length,
    },
  };
}

/** Reads router.jsonl in a log folder and computes the stats. Never throws. */
export function statsFromLogDir(logDir: string, now: Date, days: number): Stats & { problem: string | null } {
  const f = readLogFile(logDir);
  return { ...computeStats(parseLog(f.text), now, days, f.truncated), problem: f.problem };
}

// ---------- suggestions ----------

export type SuggestionKind = "budget" | "failure-rate" | "daily-cap" | "blocked";
export type Suggestion = { key: string; kind: SuggestionKind; subject: string; observation: string; fix: string };
export type SuggestLimits = { routineMaxBudgetUsd: number; dailyCapUsd: number; t2CapUsd: number };

export const MIN_CAP_HITS = 3;
export const MIN_RUNS_FOR_RATE = 5;
export const FAILURE_RATE = 0.4;
export const MIN_BLOCKED_CALLS = 5;
const money = (n: number) => `$${n.toFixed(2)}`;
/** 1.4 times the cap, rounded up to the next 5 cents. */
export const raisedBudget = (cap: number) => Math.ceil(cap * 1.4 * 20 - 1e-9) / 20;
const WHERE_BUDGET = "Edit it yourself: the routine's budgetUsd in routines/routines.json, or the skill's suggested budget line.";

/**
 * Plain rules over the numbers, in priority order. The text comes from here, never from a model, so it costs nothing.
 * Nothing in a suggestion changes anything: Jay edits config himself.
 */
export function suggestChanges(stats: Stats, limits: SuggestLimits): Suggestion[] {
  const out: Suggestion[] = [];
  const d = stats.days;
  for (const s of stats.bySkill) {
    const finished = s.done + s.failed + s.capHits;
    if (finished >= MIN_RUNS_FOR_RATE && s.failureRate !== null && s.failureRate >= FAILURE_RATE) {
      out.push({
        key: `failure-rate|skill:${s.name}`, kind: "failure-rate", subject: s.name,
        observation: `${s.name} fails ${Math.round(s.failureRate * 100)}% of the time (${s.failed} of ${finished} runs in ${d} days).`,
        fix: `Open its recent failed runs in the Runs widget to see the error, and read the skill's instructions for what it asks of the run. Run it by hand once to check. ${WHERE_BUDGET.replace(/^Edit it yourself: .*/, "If the errors are about money, see the budget suggestion instead.")}`,
      });
    }
  }
  for (const s of stats.bySkill) {
    if (s.capHits >= MIN_CAP_HITS && s.lastCapUsd !== null) {
      const to = raisedBudget(s.lastCapUsd);
      out.push({
        key: `budget|skill:${s.name}`, kind: "budget", subject: s.name,
        observation: `${s.name} hit its budget cap ${s.capHits} times in ${d} days (cap ${money(s.lastCapUsd)}).`,
        fix: to <= limits.routineMaxBudgetUsd
          ? `Raise ${s.name}'s budget to ${money(to)}. ${WHERE_BUDGET}`
          : `Raising ${s.name}'s budget to ${money(to)} would pass the per-run limit of ${money(limits.routineMaxBudgetUsd)}. Make the task smaller, or raise engine.routines.maxBudgetUsd in os/config/os.config.json yourself.`,
      });
    }
  }
  if (stats.typed.capHits >= MIN_CAP_HITS) {
    const t2 = limits.t2CapUsd;
    out.push({
      key: "budget|typed", kind: "budget", subject: "typed requests",
      observation: `Requests you typed hit their budget cap ${stats.typed.capHits} times in ${d} days.`,
      fix: `If these are T2 questions, the T2 cap is ${money(t2)}: raise engine.t2.maxBudgetUsd in os/config/os.config.json yourself (to ${money(raisedBudget(t2))} for example). T3 runs have their own cap, engine.t3.maxBudgetUsd.`,
    });
  }
  if (stats.caps.dailyRoutineCapHits >= MIN_CAP_HITS) {
    out.push({
      key: "daily-cap|routines", kind: "daily-cap", subject: "the daily routine cap",
      observation: `The daily routine cap of ${money(limits.dailyCapUsd)} stopped ${stats.caps.dailyRoutineCapHits} runs in ${d} days.`,
      fix: `Raise engine.routines.dailyCapUsd in os/config/os.config.json yourself, or switch a routine off in the Routines widget.`,
    });
  }
  for (const s of stats.bySkill) {
    if (s.blockedCalls >= MIN_BLOCKED_CALLS) {
      out.push({
        key: `blocked|skill:${s.name}`, kind: "blocked", subject: s.name,
        observation: `${s.name} had ${s.blockedCalls} tool calls blocked in ${s.blockedRuns} runs in ${d} days.`,
        fix: `The containment rules are doing their job. Look at what it tries to open (the Runs widget lists each blocked call) and ask whether the skill's instructions send it somewhere it should not go.`,
      });
    }
  }
  return out;
}
