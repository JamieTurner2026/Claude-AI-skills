// Router evals (ROADMAP 7d): load a labelled request set, run each through route(), score it.
// Pure: no file or network access here, so the scorer can be tested on hand-made sets.
// The CLI (router-eval-cli.ts) reads the file and the vault's departments.

import { TIERS, type RouteContext, type RouteResult, type Tier } from "./types.ts";
import { MAX_INPUT } from "./router.ts";

export const DEPT_SLUGS = ["software", "security", "ai", "gamedev", "industrial", "strategy", "creative"] as const;
const TAGS = new Set(["ambiguous", "trick"]);
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MAX_REQUESTS = 1000;

export type EvalRequest = { id: string; text: string; tier: Tier; dept?: string; note?: string; tags?: string[] };

export class EvalSetError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Malformed eval set:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

/** Checks the whole set and throws one error listing every problem. Accepts `{ requests: [...] }` or a bare array. */
export function loadEvalSet(raw: unknown): EvalRequest[] {
  const list: unknown = Array.isArray(raw) ? raw : (raw as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(list)) throw new EvalSetError(["expected an array of requests, or { requests: [...] }"]);
  if (list.length === 0) throw new EvalSetError(["the set has no requests"]);
  if (list.length > MAX_REQUESTS) throw new EvalSetError([`too many requests (${list.length} > ${MAX_REQUESTS})`]);

  const problems: string[] = [];
  const seen = new Set<string>();
  const out: EvalRequest[] = [];
  list.forEach((item: unknown, i) => {
    const at = `#${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) { problems.push(`${at}: not an object`); return; }
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const where = id ? `${at} (${id})` : at;
    const before = problems.length;
    if (!ID.test(id)) problems.push(`${where}: id must be a lowercase slug`);
    else if (seen.has(id)) problems.push(`${where}: duplicate id`);
    else seen.add(id);
    if (typeof r.text !== "string" || !r.text.trim()) problems.push(`${where}: text is empty`);
    else if (r.text.length > MAX_INPUT) problems.push(`${where}: text is over ${MAX_INPUT} characters`);
    if (!isTier(r.tier)) problems.push(`${where}: unknown tier ${JSON.stringify(r.tier)} (use T1, T2 or T3)`);
    if (r.dept !== undefined && !(DEPT_SLUGS as readonly unknown[]).includes(r.dept)) problems.push(`${where}: unknown dept ${JSON.stringify(r.dept)}`);
    if (r.note !== undefined && (typeof r.note !== "string" || !r.note.trim())) problems.push(`${where}: note must be non-empty text`);
    if (r.tags !== undefined && (!Array.isArray(r.tags) || !r.tags.every((t) => typeof t === "string" && TAGS.has(t)))) {
      problems.push(`${where}: tags may only be "ambiguous" or "trick"`);
    }
    const known = new Set(["id", "text", "tier", "dept", "note", "tags"]);
    for (const k of Object.keys(r)) if (!known.has(k)) problems.push(`${where}: unknown field "${k.slice(0, 40)}"`);
    if (problems.length > before) return;
    const req: EvalRequest = { id, text: r.text as string, tier: r.tier as Tier };
    if (typeof r.dept === "string") req.dept = r.dept;
    if (typeof r.note === "string") req.note = r.note;
    if (Array.isArray(r.tags)) req.tags = r.tags as string[];
    out.push(req);
  });
  if (problems.length) throw new EvalSetError(problems);
  return out;
}

export type Miss = { id: string; text: string; expected: Tier; got: Tier; probs: Record<Tier, number>; reason: string; note?: string; tags?: string[] };

export type EvalScore = {
  total: number;
  correct: number;
  accuracy: number;
  perTier: Record<Tier, { n: number; correct: number; accuracy: number }>;
  /** confusion[expected][got] = count */
  confusion: Record<Tier, Record<Tier, number>>;
  misses: Miss[];
  /** Expected T3, routed lower: answers too thin for real work. */
  underRouted: { toT2: number; toT1: number; total: number };
  /** Expected T1 or T2, routed to T3: a paid run nobody needed. */
  overRouted: { fromT1: number; fromT2: number; total: number };
};

const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);

export function scoreSet(set: readonly EvalRequest[], ctx: RouteContext, routeFn: (text: string, ctx: RouteContext) => RouteResult): EvalScore {
  const zero = (): Record<Tier, number> => ({ T1: 0, T2: 0, T3: 0 });
  const confusion: Record<Tier, Record<Tier, number>> = { T1: zero(), T2: zero(), T3: zero() };
  const misses: Miss[] = [];
  for (const req of set) {
    const r = routeFn(req.text, ctx);
    confusion[req.tier][r.tier]++;
    if (r.tier !== req.tier) {
      const m: Miss = { id: req.id, text: req.text, expected: req.tier, got: r.tier, probs: r.probs, reason: r.reason };
      if (req.note) m.note = req.note;
      if (req.tags) m.tags = req.tags;
      misses.push(m);
    }
  }
  const perTier = {} as EvalScore["perTier"];
  let correct = 0;
  for (const t of TIERS) {
    const n = confusion[t].T1 + confusion[t].T2 + confusion[t].T3;
    correct += confusion[t][t];
    perTier[t] = { n, correct: confusion[t][t], accuracy: ratio(confusion[t][t], n) };
  }
  return {
    total: set.length,
    correct,
    accuracy: ratio(correct, set.length),
    perTier,
    confusion,
    misses,
    underRouted: { toT2: confusion.T3.T2, toT1: confusion.T3.T1, total: confusion.T3.T2 + confusion.T3.T1 },
    overRouted: { fromT1: confusion.T1.T3, fromT2: confusion.T2.T3, total: confusion.T1.T3 + confusion.T2.T3 },
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const p2 = (x: number): string => x.toFixed(2);

export function formatReport(s: EvalScore): string {
  const lines: string[] = [];
  lines.push(`Router eval: ${s.correct}/${s.total} correct (${pct(s.accuracy)})`, "");
  lines.push("Per tier (expected):");
  for (const t of TIERS) lines.push(`  ${t}  ${String(s.perTier[t].correct).padStart(3)}/${String(s.perTier[t].n).padEnd(3)} ${pct(s.perTier[t].accuracy)}`);
  lines.push("", "Confusion (rows = expected, columns = router):", "          T1   T2   T3");
  for (const t of TIERS) lines.push(`  ${t}    ${TIERS.map((g) => String(s.confusion[t][g]).padStart(4)).join(" ")}`);
  lines.push("");
  lines.push(`Under-routed T3 (work given a thin answer): ${s.underRouted.total} (to T2: ${s.underRouted.toT2}, to T1: ${s.underRouted.toT1})`);
  lines.push(`Over-routed to T3 (a paid run not needed): ${s.overRouted.total} (from T1: ${s.overRouted.fromT1}, from T2: ${s.overRouted.fromT2})`);
  lines.push("", s.misses.length ? `Wrong picks (${s.misses.length}):` : "Wrong picks: none");
  for (const m of s.misses) {
    const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
    lines.push(`  ${m.id}${tags}: expected ${m.expected}, got ${m.got}  (T1 ${p2(m.probs.T1)} T2 ${p2(m.probs.T2)} T3 ${p2(m.probs.T3)})`);
    lines.push(`    "${m.text}"`);
    lines.push(`    router: ${m.reason}`);
    if (m.note) lines.push(`    note: ${m.note}`);
  }
  return lines.join("\n");
}
